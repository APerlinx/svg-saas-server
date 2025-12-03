import { Router, Request, Response } from 'express'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import { checkCoinsMiddleware } from '../middleware/checkCoins'
import prisma from '../lib/prisma'
import { generateSvg } from '../services/aiService'
import { VALID_SVG_STYLES, SvgStyle } from '../constants/svgStyles'
import { VALID_MODELS, DEFAULT_MODEL, AiModel } from '../constants/models'
import { getUserId, requireUserId } from '../utils/getUserId'
import { get } from 'http'

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
  checkCoinsMiddleware,
  async (req: Request<{}, {}, GenerateSvgBody>, res: Response) => {
    try {
      const { prompt, style, model, privacy } = req.body
      const userId = requireUserId(req)

      // Validate prompt
      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' })
      }
      if (prompt.length < 10 || prompt.length > 500) {
        return res.status(400).json({
          error: 'Prompt length must be between 10 and 500 characters',
        })
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

      // Generate SVG
      const svg = await generateSvg(prompt, style, selectedModel)
      const coinsUsed = 1
      // Store SVG generation and decrement user coins in a transaction
      const [svgGeneration, updatedUser] = await prisma.$transaction([
        prisma.svgGeneration.create({
          data: {
            userId,
            prompt,
            svg: svg,
            style,
            coinsUsed,
            model: selectedModel,
            privacy: isPrivate,
          },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { coins: { decrement: 1 } },
        }),
      ])
      // Respond with generated SVG and updated coin balance
      res.status(201).json({
        svg,
        svgGeneration: {
          id: svgGeneration.id,
          createdAt: svgGeneration.createdAt,
        },
        remainingCoins: updatedUser.coins,
      })
    } catch (error) {
      console.error('SVG Generation error:', error)
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
        coinsUsed: true,
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
    console.error('Error fetching SVG history:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/public', async (req: Request, res: Response) => {
  try {
    // Pagination parameters
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 10
    const skip = (page - 1) * limit

    // Get total count for pagination
    const totalCount = await prisma.svgGeneration.count({
      where: { privacy: false },
    })

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
        coinsUsed: true,
        createdAt: true,
      },
    })

    const totalPages = Math.ceil(totalCount / limit)
    const hasMore = page < totalPages

    res.json({
      publicGenerations,
      pagination: { currentPage: page, totalPages, totalCount, limit, hasMore },
    })
  } catch (error) {
    console.error('Error fetching public SVGs:', error)
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
      console.error('Error fetching SVG by ID:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

export default router
