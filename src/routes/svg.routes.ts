import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/auth'
import { checkCoinsMiddleware } from '../middleware/checkCoins'
import prisma from '../lib/prisma'
import { generateSvg } from '../services/aiService'

const router = Router()

interface GenerateSvgBody {
  prompt: string
  style: string
  model: string
  privacy?: boolean
}

router.post(
  '/generate-svg',
  authMiddleware,
  checkCoinsMiddleware,
  async (req: Request<{}, {}, GenerateSvgBody>, res: Response) => {
    try {
      const { prompt, style, model, privacy } = req.body
      if (!prompt) {
        return res.status(400).json({ error: 'Prompt required' })
      }
      const userId = req.user?.userId
      if (prompt.length < 10 || prompt.length > 500) {
        return res.status(400).json({
          error: 'Prompt length must be between 10 and 500 characters',
        })
      }

      // Generate SVG using AI service
      const svg = await generateSvg(prompt, style, model)
      const coinsUsed = 1
      // Store SVG generation and decrement user coins in a transaction
      const [svgGeneration, updatedUser] = await prisma.$transaction([
        prisma.svgGeneration.create({
          data: {
            userId: userId!,
            prompt,
            svg: svg,
            style,
            coinsUsed,
            model,
            privacy,
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
