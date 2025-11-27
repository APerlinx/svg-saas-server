import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/auth'
import { checkCoinsMiddleware } from '../middleware/checkCoins'
import prisma from '../lib/prisma'
import { generateSvg } from '../services/aiService'

const router = Router()

interface GenerateSvgBody {
  prompt: string
  style: string
}

router.post(
  '/generate-svg',
  authMiddleware,
  checkCoinsMiddleware,
  async (req: Request<{}, {}, GenerateSvgBody>, res: Response) => {
    try {
      const { prompt, style } = req.body
      if (!prompt || !style) {
        return res.status(400).json({ error: 'Prompt and style required' })
      }
      const userId = req.user?.userId

      const svg = await generateSvg(prompt, style)
      const coinsUsed = 1
      const [svgGeneration, updatedUser] = await prisma.$transaction([
        prisma.svgGeneration.create({
          data: {
            userId: userId!,
            prompt,
            svg: svg,
            style,
            coinsUsed,
          },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { coins: { decrement: 1 } },
        }),
      ])

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
