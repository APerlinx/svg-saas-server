import { Request, Response } from 'express'

/**
 * Sets rate limit headers on the response if quota info is available
 * @param req Express request object (with quotaInfo attached by apiQuotaLimit middleware)
 * @param res Express response object
 */
export function setRateLimitHeaders(req: Request, res: Response): void {
  const quotaInfo = (req as any).quotaInfo
  if (quotaInfo) {
    res.setHeader('X-RateLimit-Limit', quotaInfo.limit)
    res.setHeader('X-RateLimit-Remaining', quotaInfo.remaining)
    res.setHeader('X-RateLimit-Reset', quotaInfo.resetAt.toISOString())
  }
}
