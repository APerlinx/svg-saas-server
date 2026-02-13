import { Router, Request, Response } from 'express'
import { Prisma, GenerationJobStatus } from '@prisma/client'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import prisma from '../lib/prisma'
import { VALID_SVG_STYLES, SvgStyle } from '../constants/svgStyles'
import { VALID_MODELS, AiModel } from '../constants/models'
import { getUserId, requireUserId } from '../utils/getUserId'
import {
  monthlyGenerationQuota,
  incrementGenerationQuota,
} from '../middleware/monthlyGenerationQuota'
import {
  downloadLimiter,
  svgGenerationLimiter,
} from '../middleware/rateLimiter'
import { logger } from '../lib/logger'
import { createJobFailedNotification } from '../services/notificationService'
import { cache } from '../lib/cache'
import { IS_PRODUCTION, PUBLIC_ASSETS_BASE_URL } from '../config/env'
import { svgGenerationQueue } from '../jobs/svgGenerationQueue'
import { getDownloadUrl, getSvgSourceFromS3 } from '../lib/s3'
import {
  createGenerationJob,
  enqueueGenerationJob,
  getDuplicateStatus,
  formatGenerationJobResponse,
  generationJobSelect,
  ValidationError,
  ConflictError,
  NotFoundError,
  type GenerationJobWithGeneration,
} from '../services/svgGenerationService'

const router = Router()

interface GenerateSvgBody {
  prompt: string
  style: SvgStyle
  model?: AiModel
  privacy?: boolean
}

router.post(
  '/generate-svg',
  authMiddleware,
  svgGenerationLimiter,
  monthlyGenerationQuota(),
  async (req: Request<{}, {}, GenerateSvgBody>, res: Response) => {
    try {
      const { prompt, style, model, privacy } = req.body
      const userId = requireUserId(req)

      const idempotencyKey = req.header('x-idempotency-key')?.trim()

      // Create generation job (validation + idempotency check)
      const { job, duplicate } = await createGenerationJob({
        userId,
        prompt,
        style,
        model,
        privacy,
        idempotencyKey: idempotencyKey || '',
        requestId: req.requestId,
      })

      // If duplicate, return immediately (already charged)
      if (duplicate) {
        return res
          .status(getDuplicateStatus(job))
          .location(`/api/svg/generation-jobs/${job.id}`)
          .json({
            job: formatGenerationJobResponse(job),
            duplicate: true,
          })
      }

      // Debit and job flag update must be atomic to prevent partial state (e.g. charge succeeded but
      // job not marked charged) and to ensure we never charge more than once for a single job.
      const charged = await prisma.$transaction(async (tx) => {
        const debitResult = await tx.user.updateMany({
          where: { id: userId, credits: { gt: 0 } },
          data: { credits: { decrement: 1 } },
        })

        if (debitResult.count === 0) return false

        await tx.generationJob.update({
          where: { id: job.id },
          data: { creditsCharged: true },
        })

        return true
      })

      if (!charged) {
        const failedJob = await prisma.generationJob.update({
          where: { id: job.id },
          data: {
            status: GenerationJobStatus.FAILED,
            finishedAt: new Date(),
            lastFailedAt: new Date(),
            errorCode: 'INSUFFICIENT_CREDITS',
            errorMessage:
              'You do not have enough credits to generate an SVG. Please purchase more credits and try again.',
          },
        })

        await createJobFailedNotification({
          userId,
          jobId: job.id,
        })
        return res.status(402).json({
          error: failedJob.errorMessage,
        })
      }

      try {
        // After credits are charged, enqueue the async work. If enqueue fails we refund the credit
        // in an idempotent way (claim + refund) to avoid double refunds on retried error handling.
        await enqueueGenerationJob(job.id, userId)

        // Increment generation quota (non-blocking)
        await incrementGenerationQuota(userId)
      } catch (error) {
        logger.error(
          { error, jobId: job.id, userId, requestId: req.requestId },
          'Failed to enqueue SVG generation job',
        )
        await prisma.$transaction(async (tx) => {
          const refundClaim = await tx.generationJob.updateMany({
            where: {
              id: job.id,
              status: GenerationJobStatus.QUEUED,
              creditsCharged: true,
              creditsRefunded: false,
              generationId: null,
            },
            data: {
              status: GenerationJobStatus.FAILED,
              finishedAt: new Date(),
              lastFailedAt: new Date(),
              errorCode: 'ENQUEUE_FAILED',
              errorMessage: 'Failed to enqueue job.',
              creditsRefunded: true,
            },
          })

          if (refundClaim.count > 0) {
            await tx.user.update({
              where: { id: userId },
              data: { credits: { increment: 1 } },
            })
          }
        })

        await createJobFailedNotification({
          userId,
          jobId: job.id,
        })
        return res.status(503).json({
          error: 'Failed to start generation. Please retry.',
        })
      }

      let jobCounts:
        | Awaited<ReturnType<typeof svgGenerationQueue.getJobCounts>>
        | undefined

      if (!IS_PRODUCTION) {
        jobCounts = await svgGenerationQueue.getJobCounts(
          'waiting',
          'delayed',
          'active',
        )
      }

      const responsePayload = {
        job: formatGenerationJobResponse(job),
        ...(jobCounts ? { queue: jobCounts } : {}),
      }

      res
        .status(202)
        .location(`/api/svg/generation-jobs/${job.id}`)
        .json(responsePayload)
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({ error: error.message })
      }
      if (error instanceof ConflictError) {
        return res.status(409).json({ error: error.message })
      }
      if (error instanceof NotFoundError) {
        return res.status(404).json({ error: error.message })
      }

      logger.error({ error, userId: getUserId(req) }, 'SVG Generation error')
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

router.get(
  '/generation-jobs/:id',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params
      const userId = requireUserId(req)

      const generationJob = await prisma.generationJob.findFirst({
        where: {
          id,
          userId,
        },
        select: generationJobSelect,
      })

      if (!generationJob) {
        return res.status(404).json({ error: 'Generation job not found' })
      }

      const responsePayload: {
        job: ReturnType<typeof formatGenerationJobResponse>
        credits?: number | null
      } = {
        job: formatGenerationJobResponse(generationJob),
      }

      const isTerminal =
        generationJob.status === 'SUCCEEDED' ||
        generationJob.status === 'FAILED'

      if (isTerminal) {
        const user = await prisma.user.findUnique({
          where: { id: generationJob.userId },
          select: { credits: true },
        })

        responsePayload.credits = user?.credits ?? null
      }

      res.json(responsePayload)
    } catch (error) {
      logger.error(
        { error, jobId: req.params.id, userId: getUserId(req) },
        'Error fetching generation job',
      )
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

router.get(
  '/:id/download',
  authMiddleware,
  downloadLimiter,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params
      const userId = requireUserId(req)

      const generation = await prisma.svgGeneration.findFirst({
        where: {
          id,
          userId,
        },
        select: { s3Key: true },
      })

      if (!generation) {
        return res.status(404).json({ error: 'Generation not found' })
      }

      if (!generation.s3Key) {
        return res
          .status(404)
          .json({ error: 'File not available. Please try generating again.' })
      }

      const downloadUrl = await getDownloadUrl(generation.s3Key)
      res.set('Cache-Control', 'no-store')
      res.json({ downloadUrl })
    } catch (error) {
      logger.error(
        { error, generationId: req.params.id, userId: getUserId(req) },
        'Error generating download URL',
      )
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

router.get('/public', async (req: Request, res: Response) => {
  const rawLimit = Number(req.query.limit)
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 100)
    : 50

  const nextCursor =
    typeof req.query.cursor === 'string' ? req.query.cursor.trim() : undefined
  const style =
    typeof req.query.style === 'string' ? req.query.style.trim() : undefined
  const model =
    typeof req.query.model === 'string' ? req.query.model.trim() : undefined

  const isFirstPage = !nextCursor
  const cacheKey = cache.buildKey(
    'public:v4:first',
    'style',
    style ?? 'all',
    'model',
    model ?? 'all',
    'limit',
    limit,
  )

  const buildPublicSvgUrl = (s3Key?: string | null) => {
    if (!s3Key) return null
    if (!PUBLIC_ASSETS_BASE_URL) return null
    return `${PUBLIC_ASSETS_BASE_URL}/${s3Key}`
  }

  try {
    if (style && !VALID_SVG_STYLES.includes(style as SvgStyle)) {
      return res.status(400).json({
        error: `Invalid style. Must be one of: ${VALID_SVG_STYLES.join(', ')}`,
      })
    }

    if (model && !VALID_MODELS.includes(model as AiModel)) {
      return res.status(400).json({
        error: `Invalid model. Must be one of: ${VALID_MODELS.join(', ')}`,
      })
    }

    const where = {
      privacy: false,
      ...(style ? { style } : {}),
      ...(model ? { model } : {}),
    }

    const fetchPage = async (cursor?: string) => {
      const publicGenerations = await prisma.svgGeneration.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          prompt: true,
          style: true,
          model: true,
          createdAt: true,
          s3Key: true,
        },
      })

      const hasMore = publicGenerations.length > limit
      const items = hasMore ? publicGenerations.slice(0, -1) : publicGenerations
      const newNextCursor = hasMore ? items[items.length - 1]!.id : null

      return {
        publicGenerations: items.map((generation) => ({
          id: generation.id,
          prompt: generation.prompt,
          style: generation.style,
          model: generation.model,
          createdAt: generation.createdAt,
          svgUrl: buildPublicSvgUrl(generation.s3Key),
        })),
        nextCursor: newNextCursor,
      }
    }

    if (isFirstPage) {
      const cached = await cache.getOrSetJson(
        cacheKey,
        async () => fetchPage(undefined),
        { ttlSeconds: 60 },
      )
      // Cache key versioning should prevent old shapes, but keep this defensive.
      if (
        cached &&
        typeof cached === 'object' &&
        'publicGenerations' in cached &&
        Array.isArray((cached as any).publicGenerations)
      ) {
        const normalized = {
          ...(cached as any),
          publicGenerations: (cached as any).publicGenerations.map(
            (generation: any) => {
              const svgUrl =
                typeof generation?.svgUrl === 'string'
                  ? generation.svgUrl
                  : null

              return {
                id: generation?.id,
                prompt: generation?.prompt,
                style: generation?.style,
                model: generation?.model,
                createdAt: generation?.createdAt,
                svgUrl,
              }
            },
          ),
        }
        return res.json(normalized)
      }

      return res.json(cached)
    }

    return res.json(await fetchPage(nextCursor))
  } catch (error) {
    if (
      nextCursor &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      return res.status(400).json({
        error: 'Invalid cursor',
        errorCode: 'INVALID_CURSOR',
      })
    }

    logger.error({ error }, 'Error fetching new public SVGs')
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get(
  '/:id/source',
  optionalAuthMiddleware,
  async (req: Request, res: Response) => {
    try {
      const currentUserId = getUserId(req)

      const id =
        typeof req.params.id === 'string' ? req.params.id.trim() : undefined

      if (!id) {
        return res.status(400).json({ error: 'Invalid SVG ID' })
      }

      const generation = await prisma.svgGeneration.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          privacy: true,
          s3Key: true,
          svg: true,
        },
      })

      if (!generation) {
        return res.status(404).json({ error: 'SVG not found' })
      }

      if (generation.privacy && generation.userId !== currentUserId) {
        return res.status(403).json({ error: 'Access denied to this SVG' })
      }

      let svg: string | null = null

      if (generation.s3Key) {
        svg = await getSvgSourceFromS3(generation.s3Key)
      } else if (generation.svg) {
        // Dev/legacy fallback when S3 storage is disabled.
        svg = generation.svg
      }

      res.set('Cache-Control', 'no-store')
      return res.json({ id: generation.id, svg: svg ?? null })
    } catch (error) {
      logger.error(
        { error, svgId: req.params.id, userId: getUserId(req) },
        'Error fetching SVG source by ID',
      )
      return res.status(500).json({ error: 'Internal server error' })
    }
  },
)

export default router
