import prisma from '../lib/prisma'

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

    console.log(`Cleaned up ${resetTokenResult.count} expired reset tokens`)

    // Clean up expired refresh tokens (THIS IS NEW)
    const refreshTokenResult = await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    })

    console.log(`Cleaned up ${refreshTokenResult.count} expired refresh tokens`)
  } catch (error) {
    console.error('Error cleaning up expired tokens:', error)
  }
}
