import { Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { requireUserId } from '../utils/getUserId'
import { IS_TEST } from '../config/env'

/**
 * Middleware to enforce daily generation limit per user
 */
export const dailyGenerationLimit = (maxGenerations: number = 50) => {
  if (IS_TEST) {
    return (req: Request, res: Response, next: NextFunction) => next()
  }
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = requireUserId(req)

      // Get start of today (midnight)
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      // Count today's generations
      const todayGenerations = await prisma.svgGeneration.count({
        where: {
          userId,
          createdAt: { gte: today },
        },
      })

      // Check if limit reached
      if (todayGenerations >= maxGenerations) {
        return res.status(429).json({
          error: 'Daily generation limit reached. Try again tomorrow.',
          limit: maxGenerations,
          used: todayGenerations,
        })
      }

      // Add info to request for logging/display
      req.dailyGenerationCount = todayGenerations

      next()
    } catch (error) {
      console.error('Daily limit check error:', error)
      next()
    }
  }
}
