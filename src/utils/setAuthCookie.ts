import { Response } from 'express'
import { IS_PRODUCTION } from '../config/env'

// Helper function for consistent cookie settings
export const setAuthCookie = (
  res: Response,
  token: string,
  rememberMe: boolean = false
) => {
  const maxAge = rememberMe
    ? 30 * 24 * 60 * 60 * 1000 // 30 days
    : 24 * 60 * 60 * 1000 // 24 hours

  res.cookie('token', token, {
    httpOnly: true, // JavaScript can't access it (XSS protection)
    secure: IS_PRODUCTION, // HTTPS only in production
    sameSite: 'lax',
    maxAge,
    path: '/', // Available on all routes
  })
}

export const clearAuthCookie = (res: Response) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
  })
}
