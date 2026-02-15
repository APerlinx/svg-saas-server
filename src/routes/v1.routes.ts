/**
 * Public API Routes (v1)
 * External API endpoints for developers to generate SVGs programmatically
 */

import { Router, Request, Response } from 'express'
import { GenerationJobStatus } from '@prisma/client'
import { apiKeyAuth } from '../middleware/apiKeyAuth'
import {
  monthlyGenerationQuota,
  incrementGenerationQuota,
} from '../middleware/monthlyGenerationQuota'
import {
  createGenerationJob,
  enqueueGenerationJob,
  ValidationError,
  ConflictError,
  NotFoundError,
} from '../services/svgGenerationService'
import { logApiUsage } from '../services/usageTrackingService'
import { logger } from '../lib/logger'
import { requireUserId } from '../utils/getUserId'
import { setRateLimitHeaders } from '../utils/rateLimitHeaders'
import prisma from '../lib/prisma'
import { PUBLIC_ASSETS_BASE_URL } from '../config/env'

const router = Router()

/**
 * POST /v1/svg/generate
 * Generate SVG from text prompt
 */
router.post(
  '/svg/generate',
  apiKeyAuth,
  monthlyGenerationQuota(),
  async (req: Request, res: Response) => {
    const startTime = Date.now()
    const userId = requireUserId(req)
    const apiKeyId = req.apiKey!.id

    try {
      // Validate request body
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
          error: 'Invalid request body',
          message: 'Request body must be a valid JSON object',
        })
      }

      const { prompt, style, model, idempotencyKey } = req.body

      const result = await createGenerationJob({
        userId,
        prompt,
        style,
        model,
        idempotencyKey,
        source: 'API',
        apiKeyId,
      })

      // Handle duplicate requests (already processed)
      if (result.status === 'duplicate') {
        logApiUsage({
          apiKeyId,
          userId,
          endpoint: '/v1/svg/generate',
          method: 'POST',
          statusCode: 200,
          latencyMs: Date.now() - startTime,
          creditsUsed: 0,
        }).catch((err) =>
          logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'),
        )

        setRateLimitHeaders(req, res)

        return res.status(200).json({
          jobId: result.job.id,
          status: 'duplicate',
          duplicate: true,
          creditsCharged: false,
          message: 'Duplicate request detected. Returning existing job.',
        })
      }

      // Charge credits atomically
      const charged = await prisma.$transaction(async (tx) => {
        const debitResult = await tx.user.updateMany({
          where: { id: userId, credits: { gt: 0 } },
          data: { credits: { decrement: 1 } },
        })

        if (debitResult.count === 0) return false

        await tx.generationJob.update({
          where: { id: result.job.id },
          data: { creditsCharged: true },
        })

        return true
      })

      if (!charged) {
        await prisma.generationJob.update({
          where: { id: result.job.id },
          data: {
            status: GenerationJobStatus.FAILED,
            finishedAt: new Date(),
            lastFailedAt: new Date(),
            errorCode: 'INSUFFICIENT_CREDITS',
            errorMessage: 'Insufficient credits to generate SVG',
          },
        })

        logApiUsage({
          apiKeyId,
          userId,
          endpoint: '/v1/svg/generate',
          method: 'POST',
          statusCode: 402,
          latencyMs: Date.now() - startTime,
          creditsUsed: 0,
        }).catch((err) =>
          logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'),
        )

        setRateLimitHeaders(req, res)

        return res.status(402).json({
          error: 'Insufficient credits',
          message:
            'You do not have enough credits to generate an SVG. Please purchase more credits.',
        })
      }

      // Try to enqueue job, refund credit on failure
      try {
        await enqueueGenerationJob(result.job.id, userId)
        await incrementGenerationQuota(userId)
      } catch (enqueueError) {
        logger.error(
          {
            error: enqueueError,
            jobId: result.job.id,
            userId,
            apiKeyId,
          },
          'Failed to enqueue SVG generation job',
        )

        // Idempotent refund: only refund if not already refunded
        await prisma.$transaction(async (tx) => {
          const refundClaim = await tx.generationJob.updateMany({
            where: {
              id: result.job.id,
              status: GenerationJobStatus.QUEUED,
              creditsCharged: true,
              creditsRefunded: false,
              generationId: null,
            },
            data: {
              status: GenerationJobStatus.FAILED,
              errorCode: 'ENQUEUE_FAILED',
              errorMessage: 'Failed to enqueue job.',
              creditsRefunded: true,
              finishedAt: new Date(),
              lastFailedAt: new Date(),
            },
          })

          if (refundClaim.count > 0) {
            await tx.user.update({
              where: { id: userId },
              data: { credits: { increment: 1 } },
            })
            logger.info(
              { jobId: result.job.id, userId },
              'Credit refunded after enqueue failure',
            )
          }
        })

        throw enqueueError
      }

      logApiUsage({
        apiKeyId,
        userId,
        endpoint: '/v1/svg/generate',
        method: 'POST',
        statusCode: 202,
        latencyMs: Date.now() - startTime,
        creditsUsed: 1,
      }).catch((err) =>
        logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'),
      )

      setRateLimitHeaders(req, res)

      res.status(202).json({
        jobId: result.job.id,
        status: 'queued',
        creditsCharged: true,
        message: 'SVG generation job created successfully',
        estimatedCompletionTime: '30-60 seconds',
      })
    } catch (error: any) {
      // Handle validation errors
      if (error instanceof ValidationError) {
        logApiUsage({
          apiKeyId,
          userId,
          endpoint: '/v1/svg/generate',
          method: 'POST',
          statusCode: 400,
          latencyMs: Date.now() - startTime,
          creditsUsed: 0,
        }).catch((err) =>
          logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'),
        )

        setRateLimitHeaders(req, res)

        return res.status(400).json({
          error: error.message,
        })
      }

      if (error instanceof ConflictError) {
        logApiUsage({
          apiKeyId,
          userId,
          endpoint: '/v1/svg/generate',
          method: 'POST',
          statusCode: 409,
          latencyMs: Date.now() - startTime,
          creditsUsed: 0,
        }).catch((err) =>
          logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'),
        )

        setRateLimitHeaders(req, res)

        return res.status(409).json({
          error: error.message,
        })
      }

      // Handle not found errors
      if (error instanceof NotFoundError) {
        logApiUsage({
          apiKeyId,
          userId,
          endpoint: '/v1/svg/generate',
          method: 'POST',
          statusCode: 404,
          latencyMs: Date.now() - startTime,
          creditsUsed: 0,
        }).catch((err) =>
          logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'),
        )

        setRateLimitHeaders(req, res)

        return res.status(404).json({
          error: error.message,
        })
      }

      logger.error(
        {
          error,
          userId,
          apiKeyId,
          endpoint: '/v1/svg/generate',
        },
        'API generation failed',
      )

      const statusCode = error.statusCode || 500
      const errorMessage =
        error.message || 'An error occurred while processing your request'

      logApiUsage({
        apiKeyId,
        userId,
        endpoint: '/v1/svg/generate',
        method: 'POST',
        statusCode,
        latencyMs: Date.now() - startTime,
        creditsUsed: 0,
      }).catch((err) =>
        logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'),
      )

      setRateLimitHeaders(req, res)

      res.status(statusCode).json({
        error: errorMessage,
        statusCode,
      })
    }
  },
)

/**
 * GET /v1/svg/job/:id
 * Get generation job status and result
 */
router.get(
  '/svg/job/:id',
  apiKeyAuth,
  monthlyGenerationQuota({ skipCheck: true }),
  async (req: Request, res: Response) => {
    const startTime = Date.now()
    const userId = requireUserId(req)
    const apiKeyId = req.apiKey!.id

    try {
      const { id } = req.params

      const job = await prisma.generationJob.findFirst({
        where: {
          id,
          userId,
        },
        select: {
          id: true,
          status: true,
          prompt: true,
          style: true,
          model: true,
          errorCode: true,
          errorMessage: true,
          createdAt: true,
          finishedAt: true,
          creditsCharged: true,
          generation: {
            select: {
              svg: true,
              s3Key: true,
            },
          },
        },
      })

      if (!job) {
        await logApiUsage({
          apiKeyId,
          userId,
          endpoint: '/v1/svg/job/:id',
          method: 'GET',
          statusCode: 404,
          latencyMs: Date.now() - startTime,
        })

        return res.status(404).json({ error: 'Job not found' })
      }

      await logApiUsage({
        apiKeyId,
        userId,
        endpoint: '/v1/svg/job/:id',
        method: 'GET',
        statusCode: 200,
        latencyMs: Date.now() - startTime,
      })

      res.json({
        job: {
          id: job.id,
          status: job.status,
          prompt: job.prompt,
          style: job.style,
          model: job.model,
          svg: job.generation?.svg || null,
          url: job.generation?.s3Key
            ? `${PUBLIC_ASSETS_BASE_URL}/${job.generation.s3Key}`
            : null,
          errorCode: job.errorCode,
          errorMessage: job.errorMessage,
          createdAt: job.createdAt,
          finishedAt: job.finishedAt,
          creditsCharged: job.creditsCharged,
        },
      })
    } catch (error) {
      logger.error(
        {
          error,
          userId,
          apiKeyId,
          jobId: req.params.id,
        },
        'Failed to fetch job status',
      )

      await logApiUsage({
        apiKeyId,
        userId,
        endpoint: '/v1/svg/job/:id',
        method: 'GET',
        statusCode: 500,
        latencyMs: Date.now() - startTime,
      })

      res.status(500).json({ error: 'Failed to retrieve job status' })
    }
  },
)

export default router
