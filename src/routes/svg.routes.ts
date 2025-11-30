import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/auth'
import { checkCoinsMiddleware } from '../middleware/checkCoins'
import prisma from '../lib/prisma'
import { generateSvg } from '../services/aiService'
import { VALID_SVG_STYLES, SvgStyle } from '../constants/svgStyles'
import { VALID_MODELS, DEFAULT_MODEL, AiModel } from '../constants/models'

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
      const userId = req.user!.userId

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

export default router
