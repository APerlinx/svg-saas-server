import prisma from '../lib/prisma'
import { logger } from '../lib/logger'

// This function cleans up expired tokens
export async function cleanupExpiredTokens() {
  try {
    // Clean up expired password reset tokens
    const resetTokenResult = await prisma.user.updateMany({
      where: {
        resetPasswordExpires: {
          lt: new Date(),
        },
      },
      data: {
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    })

    logger.info(
      { count: resetTokenResult.count },
      'Cleaned up expired reset tokens'
    )

    // Clean up expired refresh tokens
    const refreshTokenResult = await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    })

    logger.info(
      { count: refreshTokenResult.count },
      'Cleaned up expired refresh tokens'
    )
  } catch (error) {
    logger.error({ error }, 'Error cleaning up expired tokens')
  }
}
