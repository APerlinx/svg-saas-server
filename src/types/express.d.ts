import { User as PrismaUser } from '@prisma/client'

// JWT payload structure (for authenticated routes)
export interface JwtPayload {
  userId: string
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
    }
  }
}

export {}
