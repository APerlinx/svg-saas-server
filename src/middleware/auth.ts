import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config/env'

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }

  const token = authHeader.substring(7)

  try {
    // Verify token
    if (!JWT_SECRET) {
      return res.status(500).send('JWT_SECRET is not configured')
    }
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string }
    // Attach user info to request
    req.user = { userId: decoded.userId }
    next()
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export const optionalAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next()
  }

  const token = authHeader.substring(7)

  try {
    // Verify token
    if (!JWT_SECRET) {
      return res.status(500).send('JWT_SECRET is not configured')
    }
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string }
    // Attach user info to request
    req.user = { userId: decoded.userId }
    next()
  } catch (error) {
    return next()
  }
}
