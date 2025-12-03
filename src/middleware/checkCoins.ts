import { Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { requireUserId } from '../utils/getUserId'

// Middleware to check if user has enough coins
export const checkCoinsMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = requireUserId(req)
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, coins: true, plan: true },
    })
    if (!user || user.coins <= 0) {
      return res.status(403).json({ error: 'Insufficient coins' })
    }

    // Attach user info to request for downstream handlers
    req.user = {
      userId: user.id,
    }

    next()
  } catch (error) {
    console.error('Coins check error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
