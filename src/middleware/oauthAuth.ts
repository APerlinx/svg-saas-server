import { Request, Response, NextFunction } from 'express'
import { logger } from '../lib/logger'
import prisma from '../lib/prisma'

export async function oauthAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const bearerToken = req.headers['authorization']?.split(' ')[1]

    if (!bearerToken) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Missing Bearer token in Authorization header',
      })
      return
    }

    const accessToken = await prisma.oAuthAccessToken.findFirst({
      where: {
        token: bearerToken,
        expiresAt: { gt: new Date() },
        revokedAt: null,
      },
      select: {
        id: true,
        userId: true,
      },
    })

    if (!accessToken) {
      res.status(401).json({
        error: 'Invalid or expired token',
        message: 'The provided Bearer token is invalid, expired, or revoked',
      })
      return
    }

    prisma.oAuthAccessToken
      .update({
        where: { id: accessToken.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {})

    req.user = { id: accessToken.userId } as any
    next()
  } catch (error) {
    logger.error({ error }, 'Error during OAuth authentication')
    res.status(500).json({
      error: 'Internal server error',
      message: 'An error occurred while processing the authentication',
    })
  }
}
