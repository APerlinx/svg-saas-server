import { Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { requireUserId } from '../utils/getUserId'

// Middleware to check if user has enough credits
export const checkCreditsMiddleware = async (
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
      select: { id: true, credits: true, plan: true },
    })
    if (!user || user.credits <= 0) {
      return res.status(403).json({ error: 'Insufficient credits' })
    }

    // Attach user info to request for downstream handlers
    req.user = {
      userId: user.id,
    }

    next()
  } catch (error) {
    console.error('Credits check error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
