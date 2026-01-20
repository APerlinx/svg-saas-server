import { UnrecoverableError, Worker } from 'bullmq'
import prisma from '../lib/prisma'
import { createBullMqConnection } from '../lib/bullmq'
import { SVG_GENERATION_QUEUE_NAME } from '../jobs/svgGenerationQueue'
import { logger } from '../lib/logger'
import { generateSvg } from '../services/aiService'
import { sanitizeSvg } from '../utils/sanitizeSvg'
import { cache } from '../lib/cache'
import { GenerationJobStatus } from '@prisma/client'
import { connectRedis } from '../lib/redis'
import { DEFAULT_STYLE } from '../constants/svgStyles'
import { buildGenerationSvgKey, uploadSvg } from '../lib/s3'
import { IS_PRODUCTION, IS_S3_ENABLED } from '../config/env'
import * as Sentry from '@sentry/node'
import {
  createJobFailedNotification,
  createJobSucceededNotification,
  maybeCreateOutOfCreditsNotification,
} from '../services/notificationService'

const concurrency = Number(process.env.SVG_WORKER_CONCURRENCY ?? 2)

const INSUFFICIENT_CREDITS_MESSAGE =
  'You do not have enough credits to generate an SVG. Please purchase more credits and try again.'

interface SvgGenerationJobData {
  jobId: string
  userId: string
}

function mapErrorToCode(error: unknown): { code: string; message: string } {
  if (!(error instanceof Error)) {
    return { code: 'UNKNOWN_ERROR', message: 'Unknown error' }
  }

  const message = error.message.slice(0, 500)
  const normalized = message.toLowerCase()

  if (message.includes('INSUFFICIENT_CREDITS')) {
    return { code: 'INSUFFICIENT_CREDITS', message }
  }
  if (normalized.includes('rate limit') || message.includes('429')) {
    return { code: 'OPENAI_RATE_LIMIT', message }
  }
  if (
    (normalized.includes('model') && normalized.includes('not found')) ||
    message.includes('404')
  ) {
    return { code: 'OPENAI_MODEL_NOT_FOUND', message }
  }
  if (
    normalized.includes('permission') ||
    normalized.includes('forbidden') ||
    message.includes('401') ||
    message.includes('403')
  ) {
    return { code: 'OPENAI_PERMISSION', message }
  }
  if (normalized.includes('redis') || message.includes('ECONNREFUSED')) {
    return { code: 'REDIS_DOWN', message }
  }
  if (normalized.includes('validation') || normalized.includes('invalid')) {
    return { code: 'VALIDATION_ERROR', message }
  }
  if (normalized.includes('prisma') || normalized.includes('database')) {
    return { code: 'DATABASE_ERROR', message }
  }

  return { code: 'GENERATION_FAILED', message }
}

const workerConnection = createBullMqConnection('svg-generation-worker')

;(async () => {
  await connectRedis().catch((error: unknown) => {
    logger.error({ error }, 'Worker failed to connect to Redis cache client')
    process.exit(1)
  })

  await workerConnection.ping().catch((error) => {
    logger.error({ error }, 'Failed to connect to BullMQ Redis')
    process.exit(1)
  })

  const worker = new Worker<SvgGenerationJobData>(
    SVG_GENERATION_QUEUE_NAME,
    async (job) => {
      const { jobId } = job.data
      if (!jobId) {
        throw new Error('Job is missing jobId')
      }

      try {
        await job.updateProgress(5)
        const jobRecord = await prisma.generationJob.findUnique({
          where: { id: jobId },
          select: {
            id: true,
            userId: true,
            prompt: true,
            style: true,
            model: true,
            privacy: true,
            creditsCharged: true,
            status: true,
            generationId: true,
            startedAt: true,
          },
        })

        if (!jobRecord) {
          throw new Error('Job not found')
        }

        if (
          jobRecord.generationId ||
          jobRecord.status === GenerationJobStatus.SUCCEEDED
        ) {
          logger.debug(
            { jobId, status: jobRecord.status },
            'Job already succeeded, skipping'
          )

          if (jobRecord.generationId) {
            await createJobSucceededNotification({
              userId: jobRecord.userId,
              jobId,
              generationId: jobRecord.generationId,
              prompt: jobRecord.prompt,
              style: jobRecord.style,
              model: jobRecord.model,
            })

            await maybeCreateOutOfCreditsNotification({
              userId: jobRecord.userId,
              jobId,
            })
          }
          return
        }

        const claimResult = await prisma.generationJob.updateMany({
          where: {
            id: jobId,
            status: GenerationJobStatus.QUEUED,
          },
          data: {
            status: GenerationJobStatus.RUNNING,
            startedAt: jobRecord.startedAt ?? new Date(),
            lastStartedAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        })

        if (claimResult.count === 0) {
          logger.warn(
            { jobId },
            'Job already being processed by another worker'
          )
          return
        }

        if (!jobRecord.creditsCharged) {
          await job.updateProgress(10)
          const result = await prisma.$transaction(async (tx) => {
            const debitResult = await tx.user.updateMany({
              where: { id: jobRecord.userId, credits: { gt: 0 } },
              data: { credits: { decrement: 1 } },
            })

            if (debitResult.count === 0) {
              return { success: false }
            }

            await tx.generationJob.update({
              where: { id: jobId },
              data: { creditsCharged: true },
            })

            return { success: true }
          })

          if (!result.success) {
            const now = new Date()

            await prisma.generationJob.updateMany({
              where: {
                id: jobId,
                status: GenerationJobStatus.RUNNING,
                generationId: null,
              },
              data: {
                status: GenerationJobStatus.FAILED,
                finishedAt: now,
                lastFailedAt: now,
                errorCode: 'INSUFFICIENT_CREDITS',
                errorMessage: INSUFFICIENT_CREDITS_MESSAGE,
              },
            })

            await createJobFailedNotification({
              userId: jobRecord.userId,
              jobId,
            })

            throw new UnrecoverableError('INSUFFICIENT_CREDITS')
          }
        }

        await job.updateProgress(25)
        const svg = await generateSvg(
          jobRecord.prompt,
          jobRecord.style ?? DEFAULT_STYLE,
          jobRecord.model
        )
        await job.updateProgress(75)
        const cleanSvg = sanitizeSvg(svg)
        await job.updateProgress(85)

        const generationId = await prisma.$transaction(async (tx) => {
          const generation = await tx.svgGeneration.create({
            data: {
              userId: jobRecord.userId,
              prompt: jobRecord.prompt,
              svg: cleanSvg,
              style: jobRecord.style,
              creditsUsed: 1,
              model: jobRecord.model,
              privacy: jobRecord.privacy,
            },
          })

          if (IS_S3_ENABLED) {
            const s3Key = buildGenerationSvgKey(generation.userId, jobRecord.id)
            const sizeBytes = Buffer.byteLength(cleanSvg, 'utf8')

            // Upload to S3
            await uploadSvg({
              key: s3Key,
              svg: cleanSvg,
              cacheControl: 'public, max-age=31536000, immutable',
            })

            await tx.svgGeneration.update({
              where: { id: generation.id },
              data: { s3Key, s3SizeBytes: sizeBytes },
            })
          }

          await tx.generationJob.update({
            where: { id: jobId },
            data: {
              status: GenerationJobStatus.SUCCEEDED,
              finishedAt: new Date(),
              generationId: generation.id,
            },
          })

          return generation.id
        })

        await createJobSucceededNotification({
          userId: jobRecord.userId,
          jobId,
          generationId,
          prompt: jobRecord.prompt,
          style: jobRecord.style,
          model: jobRecord.model,
        })

        await maybeCreateOutOfCreditsNotification({
          userId: jobRecord.userId,
          jobId,
        })

        await job.updateProgress(100)

        if (!jobRecord.privacy) {
          try {
            await cache.del(cache.buildKey('public', 'page', 1, 'limit', 10))
          } catch (cacheError) {
            logger.warn(
              { error: cacheError, jobId },
              'Failed to invalidate cache, but job succeeded'
            )
          }
        }

        logger.info({ jobId }, 'SVG generation job completed')
      } catch (error) {
        const mapped = mapErrorToCode(error)

        logger.error(
          {
            error: mapped.message,
            errorCode: mapped.code,
            jobId: job.data.jobId,
          },
          'SVG generation job failed'
        )

        if (IS_PRODUCTION && process.env.SENTRY_DSN) {
          Sentry.captureException(error, {
            tags: { jobId: job.data.jobId, errorCode: mapped.code },
          })
        }

        throw error
      }
    },
    {
      connection: workerConnection,
      concurrency: Number.isNaN(concurrency) ? 2 : concurrency,
    }
  )

  worker.on('completed', (job) => {
    if (!job) return
    logger.info({ jobId: job.id }, 'BullMQ worker marked job as completed')
  })

  worker.on('failed', async (job, err) => {
    if (!job) return

    const attempts = job.opts.attempts ?? 1
    const isUnrecoverable =
      err instanceof UnrecoverableError ||
      (err instanceof Error && err.name === 'UnrecoverableError')
    const isFinal = isUnrecoverable || job.attemptsMade >= attempts

    const mapped = mapErrorToCode(err)
    const errorMessage =
      mapped.code === 'INSUFFICIENT_CREDITS'
        ? INSUFFICIENT_CREDITS_MESSAGE
        : mapped.message

    // Persist failure details for UI/status tracking.
    if (!isFinal) {
      await prisma.generationJob.update({
        where: { id: job.data.jobId },
        data: {
          status: GenerationJobStatus.QUEUED,
          errorCode: mapped.code,
          errorMessage,
          attemptsMade: job.attemptsMade,
          lastFailedAt: new Date(),
        },
      })

      logger.warn(
        { jobId: job.id, error: err, attempt: job.attemptsMade },
        'Job failed, will retry'
      )
      return
    }

    if (isFinal) {
      const jobRecord = await prisma.generationJob.findUnique({
        where: { id: job.data.jobId },
        select: { userId: true },
      })

      if (jobRecord?.userId) {
        const refunded = await prisma.$transaction(async (tx) => {
          const refundClaim = await tx.generationJob.updateMany({
            where: {
              id: job.data.jobId,
              creditsCharged: true,
              creditsRefunded: false,
              generationId: null,
            },
            data: {
              creditsRefunded: true,
            },
          })

          // Only increment credits if we successfully claimed the refund
          if (refundClaim.count > 0) {
            await tx.user.update({
              where: { id: jobRecord.userId },
              data: { credits: { increment: 1 } },
            })
            return true
          }
          return false
        })

        if (refunded) {
          logger.info(
            { jobId: job.id },
            'Refunded credit after permanent failure'
          )
        }
      }

      await prisma.generationJob.update({
        where: { id: job.data.jobId },
        data: {
          status: GenerationJobStatus.FAILED,
          finishedAt: new Date(),
          errorCode: mapped.code,
          errorMessage,
          attemptsMade: job.attemptsMade,
          lastFailedAt: new Date(),
        },
      })

      if (jobRecord?.userId) {
        await createJobFailedNotification({
          userId: jobRecord.userId,
          jobId: job.data.jobId,
        })
      }
      logger.error(
        { jobId: job.id, error: mapped.message, errorCode: mapped.code },
        'Job permanently failed after retries'
      )
    }
  })

  logger.info({ concurrency }, 'SVG generation worker started and ready')
})()
