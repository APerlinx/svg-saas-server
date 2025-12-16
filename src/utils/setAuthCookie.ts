import { Response } from 'express'
import { IS_PRODUCTION } from '../config/env'

/**
 * Set access token cookie (short-lived, for API requests)
 */
export const setAccessTokenCookie = (res: Response, token: string) => {
  res.cookie('token', token, {
    httpOnly: true, // JavaScript can't access it (XSS protection)
    secure: IS_PRODUCTION, // HTTPS only in production
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000, // 15 minutes (matches ACCESS_TOKEN_EXPIRY)
    path: '/',
  })
}

/**
 * Set refresh token cookie (long-lived, for getting new access tokens)
 */
export const setRefreshTokenCookie = (
  res: Response,
  token: string,
  rememberMe: boolean = false
) => {
  const maxAge = rememberMe
    ? 30 * 24 * 60 * 60 * 1000 // 30 days if "remember me"
    : 7 * 24 * 60 * 60 * 1000 // 7 days by default

  res.cookie('refreshToken', token, {
    httpOnly: true, // JavaScript can't access it
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    maxAge,
    path: '/', // Available on all routes
  })
}

/**
 * Legacy function - sets both tokens
 * Keep for backward compatibility, but use specific functions in new code
 */
export const setAuthCookie = (
  res: Response,
  accessToken: string,
  refreshToken: string,
  rememberMe: boolean = false
) => {
  setAccessTokenCookie(res, accessToken)
  setRefreshTokenCookie(res, refreshToken, rememberMe)
}

/**
 * Clear all auth cookies (logout)
 */
export const clearAuthCookie = (res: Response) => {
  // Clear access token
  res.clearCookie('token', {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
  })

  // Clear refresh token
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
  })
}
