import prisma from '../lib/prisma'

// This function cleans up expired tokens
export async function cleanupExpiredTokens() {
  try {
    const result = await prisma.user.updateMany({
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

    console.log(`Cleaned up ${result.count} expired reset tokens`)
  } catch (error) {
    console.error('Error cleaning up expired tokens:', error)
  }
}
