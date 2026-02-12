/**
 * API Key Authentication Middleware
 * Validates API keys for public API endpoints
 */

import { Request, Response, NextFunction } from 'express'
import { validateApiKey } from '../services/apiKeyService'
import { logger } from '../lib/logger'

declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: string
        userId: string
        name: string
        scopes: string[]
        customRateLimit: number | null
        ipWhitelist: string[]
      }
    }
  }
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

    const clientIp = (req.ip || req.socket.remoteAddress || '').replace(
      '::ffff:',
      '',
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

    // Attach user and API key info to request
    req.user = validation.apiKey!.user as any
    req.apiKey = {
      id: validation.apiKey!.id,
      userId: validation.apiKey!.userId,
      name: validation.apiKey!.name,
      scopes: validation.apiKey!.scopes,
      customRateLimit: validation.apiKey!.customRateLimit,
      ipWhitelist: validation.apiKey!.ipWhitelist,
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
