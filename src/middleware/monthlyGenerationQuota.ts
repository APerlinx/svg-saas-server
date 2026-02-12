import { Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { logger } from '../lib/logger'
import { PLAN_LIMITS, type PlanType } from '../utils/planLimits'
import { getUserId } from '../utils/getUserId'
import { IS_TEST } from '../config/env'

/**
 * Quota information attached to the request
 */
export interface QuotaInfo {
  limit: number
  used: number
  remaining: number
  resetAt: Date
  resetsInDays: number
}

declare global {
  namespace Express {
    interface Request {
      quotaInfo?: QuotaInfo
    }
  }
}

/**
 * Check if user has exceeded their monthly generation quota
 * Must run AFTER authentication middleware (requires req.user)
 *
 * @param options Configuration options
 * @param options.skipCheck If true, skip quota check but still attach quota info (useful for GET endpoints)
 */
export function monthlyGenerationQuota(options?: { skipCheck?: boolean }) {
  // Bypass in test environment
  if (IS_TEST) {
    return (req: Request, res: Response, next: NextFunction) => next()
  }

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = getUserId(req)

      if (!userId) {
        res.status(401).json({ error: 'Authentication required' })
        return
      }

      const now = new Date()

      // Fetch user quota information
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          plan: true,
          generationsQuotaUsed: true,
          generationsQuotaLimit: true,
          generationsQuotaResetAt: true,
        },
      })

      if (!user) {
        res.status(401).json({ error: 'User not found' })
        return
      }

      const planLimits = PLAN_LIMITS[user.plan as PlanType]
      const quotaLimit =
        user.generationsQuotaLimit ?? planLimits.generationsPerMonth
      const quotaUsed = user.generationsQuotaUsed ?? 0
      const resetAt = user.generationsQuotaResetAt

      // Check if quota needs reset (30-day rolling window)
      const needsReset = !resetAt || now >= resetAt

      if (needsReset) {
        // Reset quota for new billing period
        const nextResetAt = new Date(now)
        nextResetAt.setDate(nextResetAt.getDate() + 30)

        await prisma.user.update({
          where: { id: userId },
          data: {
            generationsQuotaUsed: 0,
            generationsQuotaLimit: quotaLimit,
            generationsQuotaResetAt: nextResetAt,
          },
        })

        logger.info(
          {
            userId,
            plan: user.plan,
            quotaLimit,
            nextResetAt,
          },
          'Generation quota reset for new billing period',
        )

        // Attach fresh quota info to request
        req.quotaInfo = {
          limit: quotaLimit,
          used: 0,
          remaining: quotaLimit,
          resetAt: nextResetAt,
          resetsInDays: 30,
        }

        next()
        return
      }

      // Calculate remaining quota
      const remaining = Math.max(0, quotaLimit - quotaUsed)
      const daysUntilReset = Math.ceil(
        (resetAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      )

      // Attach quota info to request for response headers / logging
      req.quotaInfo = {
        limit: quotaLimit,
        used: quotaUsed,
        remaining,
        resetAt,
        resetsInDays: daysUntilReset,
      }

      // Skip check if this is a read-only endpoint (e.g., GET job status)
      if (options?.skipCheck) {
        next()
        return
      }

      // Check if quota exceeded
      if (quotaUsed >= quotaLimit) {
        logger.warn(
          {
            userId,
            plan: user.plan,
            quotaUsed,
            quotaLimit,
            resetAt,
          },
          'Generation quota exceeded',
        )

        res.status(429).json({
          error: 'Monthly generation quota exceeded',
          message: `You have used ${quotaUsed} of ${quotaLimit} generations this month. Your quota resets in ${daysUntilReset} days.`,
          quota: {
            limit: quotaLimit,
            used: quotaUsed,
            remaining: 0,
            resetAt: resetAt.toISOString(),
            resetsIn: `${daysUntilReset} ${daysUntilReset === 1 ? 'day' : 'days'}`,
          },
        })
        return
      }

      next()
    } catch (error) {
      logger.error(
        {
          error,
          userId: getUserId(req),
          path: req.path,
        },
        'Generation quota check failed',
      )

      res.status(500).json({
        error: 'Quota check failed',
        message: 'An error occurred while checking generation quota',
      })
    }
  }
}

/**
 * Increment user's generation quota usage
 * Should be called after successful generation (web or API)
 *
 * @param userId User ID to increment quota for
 */
export async function incrementGenerationQuota(userId: string): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        generationsQuotaUsed: { increment: 1 },
      },
    })

    logger.debug({ userId }, 'Generation quota incremented')
  } catch (error) {
    // Log error but don't throw - quota tracking should not block generation
    logger.error(
      {
        error,
        userId,
      },
      'Failed to increment generation quota (non-blocking)',
    )
  }
}
