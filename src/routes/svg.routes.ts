import { Router, Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import prisma from '../lib/prisma'
import { VALID_SVG_STYLES, SvgStyle } from '../constants/svgStyles'
import { VALID_MODELS, DEFAULT_MODEL, AiModel } from '../constants/models'
import { getUserId, requireUserId } from '../utils/getUserId'
import { sanitizeInput } from '../utils/sanitizeInput'
import { computeRequestHash } from '../utils/computeRequestHash'
import { dailyGenerationLimit } from '../middleware/dailyLimit'
import {
  downloadLimiter,
  svgGenerationLimiter,
} from '../middleware/rateLimiter'
import { logger } from '../lib/logger'
import { cache } from '../lib/cache'
import { IS_PRODUCTION } from '../config/env'
import {
  enqueueSvgGenerationJob,
  svgGenerationQueue,
} from '../jobs/svgGenerationQueue'
import { getDownloadUrl } from '../lib/s3'

const router = Router()

interface GenerateSvgBody {
  prompt: string
  style: SvgStyle
  model?: AiModel
  privacy?: boolean
}

const generationJobSelect = Prisma.validator<Prisma.GenerationJobSelect>()({
  id: true,
  userId: true,
  prompt: true,
  style: true,
  model: true,
  privacy: true,
  status: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  errorCode: true,
  errorMessage: true,
  generationId: true,
  requestHash: true,
  generation: {
    select: {
      id: true,
      prompt: true,
      style: true,
      model: true,
      privacy: true,
      svg: true,
      createdAt: true,
    },
  },
})

type GenerationJobWithGeneration = Prisma.GenerationJobGetPayload<{
  select: typeof generationJobSelect
}>

function getDuplicateStatus(job: GenerationJobWithGeneration) {
  return job.status === 'SUCCEEDED' || job.status === 'FAILED' ? 200 : 202
}

function formatGenerationJobResponse(job: GenerationJobWithGeneration) {
  return {
    id: job.id,
    status: job.status,
    prompt: job.prompt,
    style: job.style,
    model: job.model,
    privacy: job.privacy,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    generationId: job.generationId,
    generation: job.generation
      ? {
          id: job.generation.id,
          prompt: job.generation.prompt,
          style: job.generation.style,
          model: job.generation.model,
          privacy: job.generation.privacy,
          svg: job.generation.svg,
          createdAt: job.generation.createdAt,
        }
      : null,
  }
}

router.post(
  '/generate-svg',
  authMiddleware,
  svgGenerationLimiter,
  dailyGenerationLimit(50),
  async (req: Request<{}, {}, GenerateSvgBody>, res: Response) => {
    try {
      const { prompt, style, model, privacy } = req.body
      const userId = requireUserId(req)

      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' })
      }
      if (prompt.length < 10 || prompt.length > 500) {
        return res.status(400).json({
          error: 'Prompt length must be between 10 and 500 characters',
        })
      }
      const sanitizedPrompt = sanitizeInput(prompt)

      const forbiddenPatterns = [
        /\<script/i,
        /javascript:/i,
        /onerror=/i,
        /onload=/i,
        /<iframe/i,
        /eval\(/i,
        /system.*prompt/i,
        /ignore.*instruction/i,
        /you are now/i,
      ]

      for (const pattern of forbiddenPatterns) {
        if (pattern.test(sanitizedPrompt)) {
          return res.status(400).json({
            error:
              'Prompt contains forbidden content. Please rephrase your request.',
          })
        }
      }

      if (!style || !VALID_SVG_STYLES.includes(style as SvgStyle)) {
        return res.status(400).json({
          error: `Invalid style. Must be one of: ${VALID_SVG_STYLES.join(
            ', '
          )}`,
        })
      }

      if (model && !VALID_MODELS.includes(model as AiModel)) {
        return res.status(400).json({
          error: `Invalid model. Must be one of: ${VALID_MODELS.join(', ')}`,
        })
      }
      const selectedModel = model || DEFAULT_MODEL
      const isPrivate = privacy ?? false

      const rawIdempotencyKey = req.header('x-idempotency-key')?.trim()
      if (!rawIdempotencyKey) {
        logger.warn(
          {
            userId,
            requestId: req.requestId,
            userAgent: req.get('user-agent'),
            ip: req.ip,
          },
          'Missing x-idempotency-key header for SVG generation request'
        )

        return res.status(400).json({
          error:
            'Missing x-idempotency-key header. Please retry and ensure your client sends an idempotency key.',
        })
      }
      if (rawIdempotencyKey && rawIdempotencyKey.length > 128) {
        return res
          .status(400)
          .json({ error: 'Idempotency key must be 128 characters or fewer' })
      }

      const requestHash = computeRequestHash({
        prompt: sanitizedPrompt,
        style,
        model: selectedModel,
        privacy: isPrivate,
      })

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      })

      if (!user) {
        return res.status(404).json({ error: 'User not found' })
      }

      const existingJob = await prisma.generationJob.findFirst({
        where: {
          userId,
          idempotencyKey: rawIdempotencyKey,
        },
        select: generationJobSelect,
      })

      if (existingJob) {
        if (existingJob.requestHash === requestHash) {
          return res
            .status(getDuplicateStatus(existingJob))
            .location(`/api/svg/generation-jobs/${existingJob.id}`)
            .json({
              job: formatGenerationJobResponse(existingJob),
              duplicate: true,
            })
        } else {
          return res.status(409).json({
            error: 'Request already in progress',
          })
        }
      }

      let generationJob: GenerationJobWithGeneration

      try {
        generationJob = await prisma.generationJob.create({
          data: {
            userId,
            prompt: sanitizedPrompt,
            style,
            model: selectedModel,
            privacy: isPrivate,
            idempotencyKey: rawIdempotencyKey,
            requestHash,
          },
          select: generationJobSelect,
        })
      } catch (createError) {
        const isUniqueConstraintViolation =
          rawIdempotencyKey &&
          createError instanceof Prisma.PrismaClientKnownRequestError &&
          createError.code === 'P2002'

        if (isUniqueConstraintViolation) {
          const conflictingJob = await prisma.generationJob.findFirst({
            where: {
              userId,
              idempotencyKey: rawIdempotencyKey,
            },
            select: generationJobSelect,
          })

          if (conflictingJob) {
            if (conflictingJob.requestHash === requestHash) {
              return res
                .status(getDuplicateStatus(conflictingJob))
                .location(`/api/svg/generation-jobs/${conflictingJob.id}`)
                .json({
                  job: formatGenerationJobResponse(conflictingJob),
                  duplicate: true,
                })
            }

            return res.status(409).json({
              error:
                'Idempotency key already used with different request parameters',
            })
          }
        }

        throw createError
      }

      try {
        await enqueueSvgGenerationJob(generationJob.id, userId)
      } catch (error) {
        logger.error(
          { error, jobId: generationJob.id, userId, requestId: req.requestId },
          'Failed to enqueue SVG generation job'
        )

        await prisma.generationJob.updateMany({
          where: { id: generationJob.id, status: 'QUEUED' },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            lastFailedAt: new Date(),
            errorCode: 'ENQUEUE_FAILED',
            errorMessage: 'Failed to enqueue job.',
          },
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
          'active'
        )
      }

      const responsePayload = {
        job: formatGenerationJobResponse(generationJob),
        ...(jobCounts ? { queue: jobCounts } : {}),
      }

      res
        .status(202)
        .location(`/api/svg/generation-jobs/${generationJob.id}`)
        .json(responsePayload)
    } catch (error) {
      logger.error({ error, userId: getUserId(req) }, 'SVG Generation error')
      res.status(500).json({ error: 'Internal server error' })
    }
  }
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
        'Error fetching generation job'
      )
      res.status(500).json({ error: 'Internal server error' })
    }
  }
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
        'Error generating download URL'
      )
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

router.get('/history', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req)

    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 10
    const skip = (page - 1) * limit

    const totalCount = await prisma.svgGeneration.count({ where: { userId } })

    const generations = await prisma.svgGeneration.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: skip,
      take: limit,
      select: {
        id: true,
        prompt: true,
        style: true,
        model: true,
        privacy: true,
        creditsUsed: true,
        createdAt: true,
      },
    })

    const totalPages = Math.ceil(totalCount / limit)
    const hasMore = page < totalPages

    res.json({
      generations,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasMore,
      },
    })
  } catch (error) {
    logger.error(
      { error, userId: getUserId(req) },
      'Error fetching SVG history'
    )
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/public', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 10
    const skip = (page - 1) * limit
    const cacheKey = cache.buildKey('public', 'page', page, 'limit', limit)

    const { publicGenerations, totalCount, totalPages, hasMore } =
      await cache.getOrSetJson(
        cacheKey,
        async () => {
          const totalCount = await prisma.svgGeneration.count({
            where: { privacy: false },
          })

          const totalPages = Math.ceil(totalCount / limit) || 0
          const hasMore = page < totalPages

          const publicGenerations = await prisma.svgGeneration.findMany({
            where: { privacy: false },
            orderBy: { createdAt: 'desc' },
            skip: skip,
            take: limit,
            select: {
              id: true,
              prompt: true,
              style: true,
              model: true,
              privacy: true,
              creditsUsed: true,
              createdAt: true,
            },
          })

          return {
            publicGenerations,
            totalCount,
            totalPages,
            hasMore,
            page,
            limit,
          }
        },
        { ttlSeconds: 60 }
      )

    res.json({
      publicGenerations,
      pagination: { currentPage: page, totalPages, totalCount, limit, hasMore },
    })
  } catch (error) {
    logger.error({ error }, 'Error fetching public SVGs')
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get(
  '/:id',
  optionalAuthMiddleware,
  async (req: Request, res: Response) => {
    try {
      const currentUserId = getUserId(req)
      const { id } = req.params

      if (!id || id.trim() === '') {
        return res.status(400).json({ error: 'Invalid SVG ID' })
      }

      const svgGeneration = await prisma.svgGeneration.findUnique({
        where: { id },
      })

      if (!svgGeneration) {
        return res.status(404).json({ error: 'SVG not found' })
      }

      const isPublic = svgGeneration.privacy === false
      const isOwner = currentUserId === svgGeneration.userId

      if (!isPublic && !isOwner) {
        return res.status(404).json({ error: 'SVG not found' })
      }

      res.json({ svgGeneration })
    } catch (error) {
      logger.error({ error, svgId: req.params.id }, 'Error fetching SVG by ID')
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

export default router
