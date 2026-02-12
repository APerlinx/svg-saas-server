/**
 * API Quota Middleware
 * Enforces monthly API call limits based on subscription plan
 */

import { Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { logger } from '../lib/logger'
import { PLAN_LIMITS, type PlanType } from '../utils/planLimits'
import { getUserId } from '../utils/getUserId'

/**
 * Check if user has exceeded their monthly API quota
 * Must run AFTER apiKeyAuth middleware (requires req.user)
 */
export async function apiQuotaLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getUserId(req)

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }

    const now = new Date()

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        plan: true,
        apiQuotaUsed: true,
        apiQuotaLimit: true,
        apiQuotaResetAt: true,
      },
    })

    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }

    const planLimits = PLAN_LIMITS[user.plan as PlanType]

    if (!planLimits.apiAccess) {
      res.status(403).json({
        error: 'API access not available',
        message:
          'Your plan does not include API access. Upgrade to PRO or ENTERPRISE.',
      })
      return
    }

    const quotaLimit = user.apiQuotaLimit ?? planLimits.apiCallsPerMonth
    const quotaUsed = user.apiQuotaUsed ?? 0
    const resetAt = user.apiQuotaResetAt

    const needsReset = !resetAt || now >= resetAt

    if (needsReset) {
      const nextResetAt = new Date(now)
      nextResetAt.setDate(nextResetAt.getDate() + 30)

      await prisma.user.update({
        where: { id: userId },
        data: {
          apiQuotaUsed: 0,
          apiQuotaLimit: quotaLimit,
          apiQuotaResetAt: nextResetAt,
        },
      })

      logger.info(
        {
          userId,
          plan: user.plan,
          quotaLimit,
          nextResetAt,
        },
        'API quota reset for new billing period',
      )

      next()
      return
    }

    if (quotaUsed >= quotaLimit) {
      const daysUntilReset = Math.ceil(
        (resetAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      )

      logger.warn(
        {
          userId,
          plan: user.plan,
          quotaUsed,
          quotaLimit,
          resetAt,
        },
        'API quota exceeded',
      )

      res.status(429).json({
        error: 'API quota exceeded',
        message: `You have used ${quotaUsed} of ${quotaLimit} API calls this month.`,
        quota: {
          limit: quotaLimit,
          used: quotaUsed,
          remaining: 0,
          resetAt: resetAt.toISOString(),
          resetsIn: `${daysUntilReset} days`,
        },
      })
      return
    }

    const remaining = quotaLimit - quotaUsed

    ;(req as any).quotaInfo = {
      limit: quotaLimit,
      used: quotaUsed,
      remaining,
      resetAt,
    }

    next()
  } catch (error) {
    logger.error(
      {
        error,
        userId: getUserId(req),
        path: req.path,
      },
      'API quota check failed',
    )

    res.status(500).json({
      error: 'Quota check failed',
      message: 'An error occurred while checking API quota',
    })
  }
}
