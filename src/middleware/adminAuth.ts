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
