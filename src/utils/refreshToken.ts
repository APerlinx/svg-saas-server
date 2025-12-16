import crypto from 'crypto'
import prisma from '../lib/prisma'
import type { Prisma, RefreshToken } from '@prisma/client'

type RotateResult =
  | { ok: true; userId: string; newPlainToken: string }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'REUSED' }

const sha256 = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex')

export const generateRefreshToken = () => {
  // Prefer base64url to keep cookie smaller than hex (optional but better)
  // Node 20+: crypto.randomBytes(32).toString('base64url')
  const plainToken = crypto.randomBytes(32).toString('hex')
  return { plainToken, hashedToken: sha256(plainToken) }
}

export const createRefreshToken = async (
  userId: string,
  expiresInDays: number = 30,
  ipAddress?: string,
  userAgent?: string,
  familyId?: string,
  tx?: Prisma.TransactionClient
) => {
  const db = tx ?? prisma
  const { plainToken, hashedToken } = generateRefreshToken()

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + expiresInDays)

  const created = await db.refreshToken.create({
    data: {
      token: hashedToken,
      userId,
      expiresAt,
      ipAddress,
      userAgent,
      familyId: familyId ?? undefined,
    },
  })

  return { plainToken, record: created }
}

export const verifyAndRotateRefreshToken = async (
  oldPlainToken: string,
  expiresInDays: number = 7,
  ipAddress?: string,
  userAgent?: string
): Promise<RotateResult> => {
  const hashedOld = sha256(oldPlainToken)
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    const tokenRecord = await tx.refreshToken.findUnique({
      where: { token: hashedOld },
    })

    if (!tokenRecord) return { ok: false, reason: 'NOT_FOUND' }
    if (tokenRecord.expiresAt < now) return { ok: false, reason: 'EXPIRED' }

    // Reuse detection: token already revoked but someone is presenting it again
    if (tokenRecord.revokedAt) {
      // Revoke the whole family (best practice)
      await tx.refreshToken.updateMany({
        where: {
          userId: tokenRecord.userId,
          familyId: tokenRecord.familyId,
          revokedAt: null,
        },
        data: { revokedAt: now },
      })
      return { ok: false, reason: 'REUSED' }
    }

    // Create replacement token in same family
    const { plainToken: newPlainToken, record: newRecord } =
      await createRefreshToken(
        tokenRecord.userId,
        expiresInDays,
        ipAddress,
        userAgent,
        tokenRecord.familyId,
        tx
      )

    // Revoke old token and link it to the replacement
    await tx.refreshToken.update({
      where: { id: tokenRecord.id },
      data: {
        revokedAt: now,
        replacedByTokenId: newRecord.id,
        lastUsedAt: now,
      },
    })

    return { ok: true, userId: tokenRecord.userId, newPlainToken }
  })
}

export const revokeRefreshToken = async (plainToken: string) => {
  const hashed = sha256(plainToken)
  await prisma.refreshToken.updateMany({
    where: { token: hashed, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export const revokeAllUserTokens = async (userId: string) => {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}
