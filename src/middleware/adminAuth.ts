import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET, ADMIN_EMAIL } from '../config/env'
import { logger } from '../lib/logger'

export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const adminToken = req.cookies?.['admin_session']

    if (!adminToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Admin authentication required',
      })
    }

    // Verify JWT token
    const decoded = jwt.verify(adminToken, JWT_SECRET) as {
      email: string
      type: string
    }

    if (decoded.type !== 'admin' || decoded.email !== ADMIN_EMAIL) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid admin credentials',
      })
    }

    // Token is valid, proceed
    next()
  } catch (error) {
    logger.warn({ error }, 'Admin authentication failed')
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired admin session',
    })
  }
}

export const requireAdminOrAPIKey = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Check for API key first (for n8n/automation)
    const apiKey = req.headers['x-admin-api-key']

    if (apiKey && typeof apiKey === 'string') {
      const ADMIN_API_KEY = process.env.ADMIN_API_KEY

      if (!ADMIN_API_KEY) {
        logger.error('ADMIN_API_KEY not configured')
        return res.status(500).json({ error: 'Server misconfiguration' })
      }

      if (apiKey === ADMIN_API_KEY) {
        // Valid API key, proceed
        return next()
      } else {
        logger.warn({ ip: req.ip }, 'Invalid admin API key attempt')
        return res.status(403).json({ error: 'Invalid API key' })
      }
    }

    // Fallback to JWT cookie auth
    return requireAdmin(req, res, next)
  } catch (error) {
    logger.warn({ error }, 'Admin authentication failed')
    return res.status(401).json({ error: 'Unauthorized' })
  }
}
