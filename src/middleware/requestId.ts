import { Request, Response, NextFunction } from 'express'
import { randomBytes } from 'crypto'
import * as Sentry from '@sentry/node'

declare global {
  namespace Express {
    interface Request {
      requestId?: string
    }
  }
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Use existing x-request-id or generate new one
  const requestId =
    (req.headers['x-request-id'] as string) || randomBytes(16).toString('hex')

  // Attach to request object
  req.requestId = requestId

  // Add to response headers
  res.setHeader('x-request-id', requestId)

  // Add to Sentry scope for error tracking
  Sentry.getCurrentScope().setTag('requestId', requestId)

  next()
}
