import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { IS_PRODUCTION, IS_TEST } from '../config/env'

/**
 * Generate CSRF token and set it as a cookie
 * This runs on every request to ensure token exists
 */
export const generateCsrfToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Skip if token already exists in this request cycle
  if (req.cookies['csrf-token']) {
    return next()
  }

  // Generate random 32-byte token
  const csrfToken = crypto.randomBytes(32).toString('hex')

  // Set cookie
  res.cookie('csrf-token', csrfToken, {
    httpOnly: false, // MUST be false - JS needs to read it
    secure: IS_PRODUCTION, // HTTPS only in production
    sameSite: IS_PRODUCTION ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/', // Available on all routes
  })

  req.cookies['csrf-token'] = csrfToken
  ;(req as any).csrfToken = csrfToken

  next()
}

/**
 * Validate CSRF token on state-changing requests
 * Compares cookie value with header value
 */
export const validateCsrfToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Skip validation in test environment
  if (IS_TEST) {
    return next()
  }

  // Skip validation for safe methods (they don't change state)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next()
  }

  // Skip validation for webhook endpoints (they use signature verification)
  if (req.path.includes('/webhook')) {
    return next()
  }

  // Skip validation for OAuth callback routes
  if (
    req.path.includes('/auth/google/callback') ||
    req.path.includes('/auth/github/callback')
  ) {
    return next()
  }

  // Get token from header
  const headerToken = req.headers['x-csrf-token'] as string

  // Get token from cookie
  const cookieToken = req.cookies['csrf-token']

  // Validate: both must exist and match
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return res.status(403).json({
      error: 'Invalid CSRF token',
      message: 'Request blocked for security reasons',
    })
  }

  next()
}
