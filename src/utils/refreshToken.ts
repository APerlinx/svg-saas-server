import crypto from 'crypto'
import prisma from '../lib/prisma'

/**
 * Generate a cryptographically secure refresh token
 * Returns the plain token (to send to user) and hashed version (to store in DB)
 */
export const generateRefreshToken = () => {
  // Generate 32 random bytes, convert to hex string (64 characters)
  const plainToken = crypto.randomBytes(32).toString('hex')

  // Hash it before storing in database (same principle as passwords)
  const hashedToken = crypto
    .createHash('sha256')
    .update(plainToken)
    .digest('hex')

  return { plainToken, hashedToken }
}

export const createRefreshToken = async (
  userId: string,
  expiresInDays: number = 30,
  ipAddress?: string,
  userAgent?: string
) => {
  const { plainToken, hashedToken } = generateRefreshToken()

  // Calculate expiration date
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + expiresInDays)

  // Store in database
  await prisma.refreshToken.create({
    data: {
      token: hashedToken,
      userId,
      expiresAt,
      ipAddress,
      userAgent,
    },
  })

  return plainToken
}

export const verifyRefreshToken = async (plainToken: string) => {
  // Hash the incoming token to compare with DB
  const hashedToken = crypto
    .createHash('sha256')
    .update(plainToken)
    .digest('hex')

  // Find token in database
  const tokenRecord = await prisma.refreshToken.findUnique({
    where: { token: hashedToken },
  })

  // Check if exists and not expired
  if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
    return null
  }

  // Update last used timestamp
  await prisma.refreshToken.update({
    where: { id: tokenRecord.id },
    data: { lastUsedAt: new Date() },
  })

  return tokenRecord.userId
}

/**
 * Delete a specific refresh token (single device logout)
 */
export const revokeRefreshToken = async (plainToken: string) => {
  const hashedToken = crypto
    .createHash('sha256')
    .update(plainToken)
    .digest('hex')

  try {
    await prisma.refreshToken.delete({
      where: { token: hashedToken },
    })
  } catch (error) {
    console.log('Refresh token not found (may already be revoked)')
  }
}

/**
 * Delete all refresh tokens for a user (logout from all devices)
 */
export const revokeAllUserTokens = async (userId: string) => {
  await prisma.refreshToken.deleteMany({
    where: { userId },
  })
}

// Add this new function
export const rotateRefreshToken = async (
  oldPlainToken: string,
  userId: string,
  expiresInDays: number = 7,
  ipAddress?: string,
  userAgent?: string
) => {
  // Hash the old token
  const hashedToken = crypto
    .createHash('sha256')
    .update(oldPlainToken)
    .digest('hex')

  // Verify it exists and get the record
  const tokenRecord = await prisma.refreshToken.findUnique({
    where: { token: hashedToken },
  })

  if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
    return null
  }

  // Delete the old token
  await prisma.refreshToken.deleteMany({
    where: { id: tokenRecord.id },
  })

  // Create a new token with same expiry duration
  const newPlainToken = await createRefreshToken(
    userId,
    expiresInDays,
    ipAddress,
    userAgent
  )

  return newPlainToken
}
