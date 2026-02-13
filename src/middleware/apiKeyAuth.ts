/**
 * API Key Authentication Middleware
 * Validates API keys for public API endpoints
 */

import { Request, Response, NextFunction } from 'express'
import { validateApiKey } from '../services/apiKeyService'
import { logger } from '../lib/logger'
import { PLAN_LIMITS, type PlanType } from '../utils/planLimits'

/**
 * Extract client IP with Cloudflare priority
 * Cloudflare sets cf-connecting-ip to the real client IP
 * Fallback to Express req.ip (respects trust proxy setting)
 */
function getClientIp(req: Request): string {
  const cfIp = req.headers['cf-connecting-ip']
  const ip = cfIp || req.ip || req.socket.remoteAddress || ''
  return ip.toString().replace('::ffff:', '')
}

/**
 * Middleware to authenticate API requests using API keys
 * Extracts X-API-Key header and validates it
 */
export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rawKey = req.headers['x-api-key'] as string

    if (!rawKey) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Missing X-API-Key header',
      })
      return
    }

    const clientIp = getClientIp(req)

    logger.debug(
      {
        clientIp,
        cfConnectingIp: req.headers['cf-connecting-ip'],
        rawIp: req.ip,
        socketIp: req.socket.remoteAddress,
        xForwardedFor: req.headers['x-forwarded-for'],
      },
      'API request IP detection',
    )

    const validation = await validateApiKey(rawKey, clientIp)

    if (!validation.valid) {
      logger.warn(
        {
          reason: validation.reason,
          ip: clientIp,
          path: req.path,
        },
        'API key validation failed',
      )

      res.status(401).json({
        error: 'Invalid API key',
        message: validation.reason,
      })
      return
    }

    req.user = validation.apiKey!.user as any
    req.apiKey = {
      id: validation.apiKey!.id,
      userId: validation.apiKey!.userId,
      name: validation.apiKey!.name,
      scopes: validation.apiKey!.scopes,
      customRateLimit: validation.apiKey!.customRateLimit,
      ipWhitelist: validation.apiKey!.ipWhitelist,
    }

    // Check if user's current plan allows API access
    const userPlan = validation.apiKey!.user.plan as PlanType
    const planLimits = PLAN_LIMITS[userPlan]

    if (!planLimits.apiAccess) {
      logger.warn(
        {
          userId: validation.apiKey!.userId,
          plan: userPlan,
          apiKeyId: validation.apiKey!.id,
          ip: clientIp,
        },
        'API access denied - plan does not allow API access',
      )

      res.status(403).json({
        error: 'API access not available',
        message: `Your current plan (${userPlan}) does not include API access. Please upgrade to PRO or ENTERPRISE to use the API.`,
        currentPlan: userPlan,
      })
      return
    }

    next()
  } catch (error) {
    logger.error(
      {
        error,
        path: req.path,
        method: req.method,
      },
      'API key authentication error',
    )

    res.status(500).json({
      error: 'Authentication failed',
      message: 'An error occurred during authentication',
    })
  }
}
