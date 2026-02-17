/**
 * Unified Rate Limiting Middleware
 *
 * Supports two modes:
 * 1. Fixed rate limits (IP or custom key based) - for auth, downloads, etc.
 * 2. Plan-based rate limits (user-specific based on subscription) - for API
 */

import { Request, Response, NextFunction } from 'express'
import { redisClient } from '../lib/redis'
import { IS_TEST, IS_PRODUCTION } from '../config/env'
import { logger } from '../lib/logger'
import { getPlanLimits } from '../utils/planLimits'
import prisma from '../lib/prisma'
import * as Sentry from '@sentry/node'

// Lua script for atomic rate limit operations
const RATE_LIMIT_LUA = `
  local key = KEYS[1]              
  local window = tonumber(ARGV[1]) 
  local limit = tonumber(ARGV[2])  
  
  local current = redis.call('GET', key)
  
  if current and tonumber(current) >= limit then
    local ttl = redis.call('TTL', key)
    return {0, ttl}
  end
  
  local count = redis.call('INCR', key)
  
  if count == 1 then
    redis.call('EXPIRE', key, window)
  end
  
  local ttl = redis.call('TTL', key)     
  local remaining = limit - count         
  
  return {remaining, ttl}
`

/**
 * Rate limit information attached to request
 */
export interface RateLimitInfo {
  limit: number
  used: number
  remaining: number
  resetAt: Date
  retryAfter?: number
}

/**
 * Options for fixed rate limiter
 */
interface FixedRateLimitOptions {
  windowMs: number
  max: number
  message: string
  keyPrefix: string
  keyGenerator?: (req: Request) => string
}

/**
 * Options for plan-based rate limiter
 */
interface PlanRateLimitOptions {
  skipAuth?: boolean
}

/**
 * Get user ID from request (supports session and API key auth)
 */
function getUserId(req: Request): string | null {
  // Session auth (web app)
  if (req.user) {
    if ('id' in req.user) {
      return req.user.id
    }
    if ('userId' in req.user) {
      return req.user.userId
    }
  }

  // API key auth (public API)
  if (req.apiUser?.id) {
    return req.apiUser.id
  }

  return null
}

/**
 * Get hour-based window key for plan rate limiting
 * Format: ratelimit:plan:userId:2026-02-16-14
 */
function getPlanRateLimitKey(userId: string): string {
  const now = new Date()
  const hourWindow = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}`
  return `ratelimit:plan:${userId}:${hourWindow}`
}

/**
 * Get when current hour window ends
 */
function getHourWindowReset(): Date {
  const now = new Date()
  const reset = new Date(now)
  reset.setUTCMinutes(0, 0, 0)
  reset.setUTCHours(reset.getUTCHours() + 1)
  return reset
}

/**
 * Fixed rate limiter (IP or custom key based)
 * Used for auth, downloads, support, etc.
 */
export const createRateLimiter = (options: FixedRateLimitOptions) => {
  const { windowMs, max, message, keyPrefix, keyGenerator } = options

  const windowSeconds = Math.floor(windowMs / 1000)

  return async (req: Request, res: Response, next: NextFunction) => {
    if (IS_TEST) {
      return next()
    }

    try {
      if (!redisClient.isOpen) {
        logger.warn('Redis not connected, skipping rate limit')
        return next()
      }

      const identifier = keyGenerator ? keyGenerator(req) : req.ip || 'unknown'
      const key = `${keyPrefix}:${identifier}`

      const result = (await redisClient.eval(RATE_LIMIT_LUA, {
        keys: [key],
        arguments: [windowSeconds.toString(), max.toString()],
      })) as number[]

      const [remaining, ttl] = result

      res.setHeader('X-RateLimit-Limit', max.toString())
      res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining).toString())
      res.setHeader('X-RateLimit-Reset', (Date.now() + ttl * 1000).toString())

      if (remaining <= 0) {
        res.setHeader('Retry-After', ttl.toString())
        logger.warn(
          {
            key,
            identifier,
            limit: max,
            ttl,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            path: req.path,
            method: req.method,
            requestId: (req as any).requestId,
          },
          'Rate limit exceeded',
        )

        // Alert on excessive violations in production
        if (IS_PRODUCTION && process.env.SENTRY_DSN) {
          Sentry.captureMessage('Rate limit exceeded', {
            level: 'warning',
            tags: {
              rate_limit: keyPrefix,
              ip: identifier,
              path: req.path,
            },
            extra: {
              limit: max,
              windowMs,
              userAgent: req.get('user-agent'),
            },
          })
        }

        return res.status(429).json({ error: message })
      }

      next()
    } catch (error) {
      logger.error({ error }, 'Rate limiter error, allowing request')
      next()
    }
  }
}

/**
 * Plan-based rate limiter (user subscription tier based)
 * Used for authenticated API endpoints - enforces plan limits
 */
export function createPlanRateLimiter(options: PlanRateLimitOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (IS_TEST) {
      return next()
    }

    try {
      const userId = getUserId(req)

      // Skip if not authenticated and skipAuth is true
      if (!userId && options.skipAuth) {
        return next()
      }

      // Require authentication
      if (!userId) {
        return res.status(401).json({
          error: 'Authentication required',
          message: 'Rate limiting requires authentication',
        })
      }

      if (!redisClient.isOpen) {
        logger.warn('Redis not connected, skipping plan rate limit')
        return next()
      }

      // Fetch user's plan
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { plan: true },
      })

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'Unable to determine rate limits',
        })
      }

      // Get plan limits
      const planLimits = getPlanLimits(user.plan)
      const requestsPerHour = planLimits.rateLimits.perHour

      // Get Redis key for current hour window
      const key = getPlanRateLimitKey(userId)
      const resetAt = getHourWindowReset()

      // Increment request count atomically
      const currentCount = await redisClient.incr(key)

      // Set expiry on first request (1 hour)
      if (currentCount === 1) {
        await redisClient.expire(key, 3600)
      }

      const remaining = Math.max(0, requestsPerHour - currentCount)
      const rateLimitInfo: RateLimitInfo = {
        limit: requestsPerHour,
        used: currentCount,
        remaining,
        resetAt,
      }

      // Attach to request
      req.rateLimitInfo = rateLimitInfo

      // Set headers
      res.setHeader('X-RateLimit-Limit', requestsPerHour.toString())
      res.setHeader('X-RateLimit-Remaining', remaining.toString())
      res.setHeader('X-RateLimit-Reset', resetAt.toISOString())

      // Check if exceeded
      if (currentCount > requestsPerHour) {
        const retryAfter = Math.ceil((resetAt.getTime() - Date.now()) / 1000)
        rateLimitInfo.retryAfter = retryAfter

        res.setHeader('Retry-After', retryAfter.toString())

        logger.warn(
          {
            userId,
            plan: user.plan,
            limit: requestsPerHour,
            used: currentCount,
            path: req.path,
            method: req.method,
          },
          'Plan rate limit exceeded',
        )

        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: `You have exceeded the rate limit of ${requestsPerHour} requests per hour. Please try again later.`,
          rateLimit: rateLimitInfo,
        })
      }

      logger.debug(
        {
          userId,
          plan: user.plan,
          used: currentCount,
          limit: requestsPerHour,
          remaining,
        },
        'Plan rate limit check passed',
      )

      next()
    } catch (error) {
      logger.error(
        {
          error,
          userId: getUserId(req),
          path: req.path,
        },
        'Plan rate limit check failed',
      )

      // Fail open - don't block requests if rate limiting fails
      logger.warn('Plan rate limiting failed - allowing request to proceed')
      next()
    }
  }
}

/**
 * Get current rate limit status for a user
 */
export async function getRateLimitStatus(
  userId: string,
): Promise<RateLimitInfo | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    })

    if (!user) {
      return null
    }

    const planLimits = getPlanLimits(user.plan)
    const requestsPerHour = planLimits.rateLimits.perHour

    const key = getPlanRateLimitKey(userId)
    const resetAt = getHourWindowReset()

    const currentCount = await redisClient.get(key)
    const used = currentCount ? parseInt(currentCount, 10) : 0
    const remaining = Math.max(0, requestsPerHour - used)

    return {
      limit: requestsPerHour,
      used,
      remaining,
      resetAt,
    }
  } catch (error) {
    logger.error({ error, userId }, 'Failed to get rate limit status')
    return null
  }
}

// =============================================================================
// Pre-configured rate limiters for common use cases
// =============================================================================

/**
 * Auth endpoints (login, register, OAuth)
 * 5 attempts per IP per 15 minutes
 */
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many authentication attempts. Please try again later.',
  keyPrefix: 'rl:auth',
})

/**
 * Password reset endpoints
 * 3 attempts per IP per 15 minutes
 */
export const forgotPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Too many password reset requests. Please try again later.',
  keyPrefix: 'rl:forgot',
})

/**
 * General API endpoints (legacy, for backward compatibility)
 * 100 requests per IP per 15 minutes
 */
export const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests. Please try again later.',
  keyPrefix: 'rl:api',
})

/**
 * SVG generation in web app (user-based)
 * 10 generations per user per hour
 */
export const svgGenerationLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Generation limit reached. Please try again later.',
  keyPrefix: 'rl:svg',
  keyGenerator: (req) => {
    const userId = getUserId(req)
    return userId || req.ip || 'unknown'
  },
})

/**
 * Download endpoints (user-based)
 * 20 downloads per user per minute
 */
export const downloadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many download requests. Please try again later.',
  keyPrefix: 'rl:download',
  keyGenerator: (req) => {
    const userId = getUserId(req)
    return userId || req.ip || 'unknown'
  },
})

/**
 * Support message endpoints
 * 5 submissions per IP per 10 minutes
 */
export const supportMessageLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: 'Too many support messages. Please try again later.',
  keyPrefix: 'rl:support',
})
