import { Request } from 'express'
import { JwtPayload } from '../types/express'

/**
 * Get user ID from request
 * Supports both JWT auth (userId) and API key auth (id)
 */
export function getUserId(req: Request): string | undefined {
  // JWT auth uses req.user.userId
  const jwtUserId = (req.user as JwtPayload)?.userId
  if (jwtUserId) return jwtUserId

  // API key auth / OAuth uses req.user.id
  const prismaUserId = (req.user as any)?.id
  return prismaUserId
}

export function requireUserId(req: Request): string {
  const userId = getUserId(req)
  if (!userId) {
    throw new Error('User not authenticated')
  }
  return userId
}
