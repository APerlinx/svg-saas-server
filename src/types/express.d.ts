import { User as PrismaUser } from '@prisma/client'

// JWT payload structure (for authenticated routes)
export interface JwtPayload {
  userId: string
}

declare global {
  namespace Express {
    // For OAuth - Passport returns full Prisma user
    interface User extends PrismaUser {}

    // For JWT auth - authMiddleware sets this (can be JwtPayload or full PrismaUser from OAuth)
    interface Request {
      user?: JwtPayload | PrismaUser
    }
  }
}

export {}
