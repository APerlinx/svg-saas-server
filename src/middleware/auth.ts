import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

declare global {
  namespace Express {
    interface Request {
      user?: { userId: string }
    }
  }
}

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
    const jwtSecret = process.env.JWT_SECRET
    if (!jwtSecret) {
      return res.status(500).send('JWT_SECRET is not configured')
    }
    const decoded = jwt.verify(token, jwtSecret) as { userId: string }
    // Attach user info to request
    req.user = { userId: decoded.userId }
    next()
  } catch (errpr) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}
