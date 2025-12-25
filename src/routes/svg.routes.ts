import { Router, Request, Response } from 'express'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import { checkCreditsMiddleware } from '../middleware/checkCredits'
import prisma from '../lib/prisma'
import { generateSvg } from '../services/aiService'
import { VALID_SVG_STYLES, SvgStyle } from '../constants/svgStyles'
import { VALID_MODELS, DEFAULT_MODEL, AiModel } from '../constants/models'
import { getUserId, requireUserId } from '../utils/getUserId'
import { sanitizeInput } from '../utils/sanitizeInput'
import { sanitizeSvg } from '../utils/sanitizeSvg'
import { dailyGenerationLimit } from '../middleware/dailyLimit'
import { svgGenerationLimiter } from '../middleware/rateLimiter'
import { logger } from '../lib/logger'
import { cache } from '../lib/cache'

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
  checkCreditsMiddleware,
  dailyGenerationLimit(50),
  async (req: Request<{}, {}, GenerateSvgBody>, res: Response) => {
    try {
      const { prompt, style, model, privacy } = req.body
      const userId = requireUserId(req)

      // Validate and sanitize prompt
      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' })
      }
      if (prompt.length < 10 || prompt.length > 500) {
        return res.status(400).json({
          error: 'Prompt length must be between 10 and 500 characters',
        })
      }
      const sanitizedPrompt = sanitizeInput(prompt) // Basic sanitization
      // Forbidden patterns
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

      // Validate style
      if (!style || !VALID_SVG_STYLES.includes(style as SvgStyle)) {
        return res.status(400).json({
          error: `Invalid style. Must be one of: ${VALID_SVG_STYLES.join(
            ', '
          )}`,
        })
      }

      // Validate model
      if (model && !VALID_MODELS.includes(model as AiModel)) {
        return res.status(400).json({
          error: `Invalid model. Must be one of: ${VALID_MODELS.join(', ')}`,
        })
      }
      const selectedModel = model || DEFAULT_MODEL
      const isPrivate = privacy ?? false

      // # Generate SVG #
      const rawSvg = await generateSvg(sanitizedPrompt, style, selectedModel)
      const cleanSvg = sanitizeSvg(rawSvg)

      const creditsUsed = 1
      // Store SVG generation and decrement user credits in a transaction
      const [, updatedUser] = await prisma.$transaction([
        prisma.svgGeneration.create({
          data: {
            userId,
            prompt,
            svg: cleanSvg,
            style,
            creditsUsed,
            model: selectedModel,
            privacy: isPrivate,
          },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { credits: { decrement: 1 } },
        }),
      ])

      // If this SVG is public, invalidate the hot public cache page
      if (!isPrivate) {
        await cache.del(cache.buildKey('public', 'page', 1, 'limit', 10))
      }
      // Respond with generated SVG
      res.status(201).json({
        svgCode: cleanSvg,
        credits: updatedUser.credits,
      })
    } catch (error) {
      logger.error({ error, userId: getUserId(req) }, 'SVG Generation error')
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

router.get('/history', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req)

    // Pagination parameters
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 10
    const skip = (page - 1) * limit

    // Get total count for pagination
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

    // Try to get from cache
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

      // Fetch the SVG first
      const svgGeneration = await prisma.svgGeneration.findUnique({
        where: { id },
      })

      // Check if exists
      if (!svgGeneration) {
        return res.status(404).json({ error: 'SVG not found' })
      }

      // Authorization check
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
