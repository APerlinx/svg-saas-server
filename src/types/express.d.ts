import { User as PrismaUser } from '@prisma/client'

// JWT payload structure (for authenticated routes)
export interface JwtPayload {
  userId: string
}

// Rate limit info attached by rate limiting middleware
export interface RateLimitInfo {
  limit: number
  used: number
  remaining: number
  resetAt: Date
  retryAfter?: number
}

// Generation quota info attached by monthly quota middleware
export interface QuotaInfo {
  limit: number
  used: number
  remaining: number
  resetAt: Date
  resetsInDays: number
}

declare global {
  namespace Express {
    // For OAuth - Passport returns full Prisma user
    interface User extends PrismaUser {}

    // For JWT auth - authMiddleware sets this (can be JwtPayload or full PrismaUser from OAuth/API)
    interface Request {
      user?: JwtPayload | PrismaUser
      dailyGenerationCount?: number
      apiKey?: {
        id: string
        userId: string
        name: string
        scopes: string[]
        customRateLimit: number | null
        ipWhitelist: string[]
      }
      // API user when using API key auth
      apiUser?: PrismaUser
      // Rate limit tracking (set by rateLimitMiddleware)
      rateLimitInfo?: RateLimitInfo
      // Generation quota tracking (set by monthlyGenerationQuota)
      quotaInfo?: QuotaInfo
    }
  }
}

export {}
