/**
 * Public API Routes (v1)
 * External API endpoints for developers to generate SVGs programmatically
 */

import { Router, Request, Response } from 'express'
import { apiKeyAuth } from '../middleware/apiKeyAuth'
import { apiQuotaLimit } from '../middleware/apiQuotaLimit'
import { createGenerationJob } from '../services/svgGenerationService'
import {
  logApiUsage,
  incrementApiQuota,
} from '../services/usageTrackingService'
import { logger } from '../lib/logger'
import { requireUserId } from '../utils/getUserId'
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
  apiQuotaLimit,
  async (req: Request, res: Response) => {
    const startTime = Date.now()
    const userId = requireUserId(req)
    const apiKeyId = req.apiKey!.id

    try {
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

      if (result.status !== 'duplicate') {
        await incrementApiQuota(userId)
      }

      logApiUsage({
        apiKeyId,
        userId,
        endpoint: '/v1/svg/generate',
        method: 'POST',
        statusCode: result.status === 'duplicate' ? 200 : 202,
        latencyMs: Date.now() - startTime,
        creditsUsed: result.creditsCharged ? 1 : 0,
      }).catch((err) =>
        logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'),
      )

      const quotaInfo = (req as any).quotaInfo
      if (quotaInfo) {
        res.setHeader('X-RateLimit-Limit', quotaInfo.limit)
        res.setHeader('X-RateLimit-Remaining', quotaInfo.remaining)
        res.setHeader('X-RateLimit-Reset', quotaInfo.resetAt.toISOString())
      }

      const statusCode = result.status === 'duplicate' ? 200 : 202

      res.status(statusCode).json({
        jobId: result.job.id,
        status: result.status,
        message:
          result.status === 'duplicate'
            ? 'Duplicate request detected. Returning existing job.'
            : 'SVG generation job created successfully',
        creditsCharged: result.creditsCharged,
        estimatedCompletionTime: '30-60 seconds',
      })
    } catch (error: any) {
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
router.get('/svg/job/:id', apiKeyAuth, async (req: Request, res: Response) => {
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
})

export default router
