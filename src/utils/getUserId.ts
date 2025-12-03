import { Request } from 'express'
import { JwtPayload } from '../types/express'

export function getUserId(req: Request): string | undefined {
  return (req.user as JwtPayload)?.userId
}

export function requireUserId(req: Request): string {
  const userId = (req.user as JwtPayload)?.userId
  if (!userId) {
    throw new Error('User not authenticated')
  }
  return userId
}
