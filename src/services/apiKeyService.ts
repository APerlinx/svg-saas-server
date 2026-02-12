/**
 * API Key Service
 * Handles creation, validation, and management of API keys
 */

import crypto from 'crypto'
import prisma from '../lib/prisma'
import { logger } from '../lib/logger'
import { PLAN_LIMITS, type PlanType } from '../utils/planLimits'

/**
 * Generate a secure API key
 * Format: sk_{env}_{32_random_bytes}
 *
 * Example: sk_live_abc123def456...
 */
export function generateSecureKey(
  environment: 'production' | 'test' = 'production',
): string {
  const prefix = environment === 'production' ? 'sk_live' : 'sk_test'
  const randomBytes = crypto.randomBytes(24).toString('hex') // 48 chars
  return `${prefix}_${randomBytes}`
}

/**
 * Hash an API key using SHA-256
 * We NEVER store the raw key, only the hash
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

/**
 * Get the display prefix of a key (first 12 chars + ****)
 * Example: sk_live_abc1****
 */
export function getKeyPrefix(rawKey: string): string {
  if (rawKey.length < 12) return rawKey
  return `${rawKey.substring(0, 12)}****`
}

interface CreateApiKeyParams {
  userId: string
  name: string
  description?: string
  environment?: 'production' | 'test'
  customRateLimit?: number
  ipWhitelist?: string[]
  expiresAt?: Date
}

interface CreateApiKeyResult {
  id: string
  rawKey: string // ⚠️ Only returned once at creation!
  keyPrefix: string
  name: string
  createdAt: Date
}

/**
 * Create a new API key for a user
 *
 * Steps:
 * 1. Check if user's plan allows API access
 * 2. Check if user hasn't exceeded max API keys
 * 3. Generate secure key
 * 4. Hash the key (never store raw)
 * 5. Store in database
 * 6. Return raw key (only time it's visible!)
 */
export async function createApiKey(
  params: CreateApiKeyParams,
): Promise<CreateApiKeyResult> {
  const {
    userId,
    name,
    description,
    environment,
    customRateLimit,
    ipWhitelist,
    expiresAt,
  } = params

  console.log('🔑 Creating API key:', { userId, name, environment })

  // 1. Get user and check plan
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })

  console.log('👤 User found:', { userId, plan: user?.plan })

  if (!user) {
    throw new Error('User not found')
  }

  const planLimits = PLAN_LIMITS[user.plan as PlanType]

  // 2. Check if plan allows API access
  if (!planLimits.apiAccess) {
    throw new Error('API access requires PRO or ENTERPRISE plan')
  }

  // 3. Check current key count
  const currentKeyCount = await prisma.apiKey.count({
    where: {
      userId,
      revokedAt: null, // Only count active keys
    },
  })

  if (currentKeyCount >= planLimits.maxApiKeys) {
    throw new Error(
      `Maximum API keys reached. Your plan allows ${planLimits.maxApiKeys} keys.`,
    )
  }

  // 4. Generate secure key
  const rawKey = generateSecureKey(environment || 'production')
  const keyHash = hashApiKey(rawKey)
  const keyPrefix = getKeyPrefix(rawKey)

  // 5. Create API key in database
  const apiKey = await prisma.apiKey.create({
    data: {
      userId,
      name,
      description,
      keyHash,
      keyPrefix,
      environment: environment || 'production',
      customRateLimit,
      ipWhitelist: ipWhitelist || [],
      expiresAt,
    },
  })

  logger.info(
    { userId, apiKeyId: apiKey.id, keyPrefix, environment: apiKey.environment },
    'API key created',
  )

  return {
    id: apiKey.id,
    rawKey, // ⚠️ Only returned once at creation
    keyPrefix,
    name: apiKey.name,
    createdAt: apiKey.createdAt,
  }
}

interface ValidateApiKeyResult {
  valid: boolean
  apiKey?: {
    id: string
    userId: string
    name: string
    scopes: string[]
    customRateLimit: number | null
    ipWhitelist: string[]
    user: {
      id: string
      email: string
      plan: string
      credits: number
      apiQuotaUsed: number | null
      apiQuotaLimit: number | null
      apiQuotaResetAt: Date | null
    }
  }
  reason?: string // If invalid, why?
}

/**
 * Validate an API key
 *
 * Checks:
 * 1. Key exists and hash matches
 * 2. Not revoked
 * 3. Not expired
 * 4. Optional: IP whitelist
 *
 * Also updates lastUsedAt and usageCount
 */
export async function validateApiKey(
  rawKey: string,
  ipAddress?: string,
): Promise<ValidateApiKeyResult> {
  // Hash the provided key
  const keyHash = hashApiKey(rawKey)

  // Find the key with user info
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          plan: true,
          credits: true,
          apiQuotaUsed: true,
          apiQuotaLimit: true,
          apiQuotaResetAt: true,
        },
      },
    },
  })

  // Key doesn't exist
  if (!apiKey) {
    return { valid: false, reason: 'Invalid API key' }
  }

  // Key is revoked
  if (apiKey.revokedAt) {
    return { valid: false, reason: 'API key has been revoked' }
  }

  // Key is expired
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return { valid: false, reason: 'API key has expired' }
  }

  if (apiKey.ipWhitelist.length > 0 && ipAddress) {
    if (!apiKey.ipWhitelist.includes(ipAddress)) {
      logger.warn(
        { apiKeyId: apiKey.id, ipAddress, whitelist: apiKey.ipWhitelist },
        'API key used from non-whitelisted IP',
      )
      return { valid: false, reason: 'IP address not whitelisted' }
    }
  }

  // Update usage statistics asynchronously
  prisma.apiKey
    .update({
      where: { id: apiKey.id },
      data: {
        lastUsedAt: new Date(),
        usageCount: { increment: 1 },
      },
    })
    .catch((err) => {
      logger.error(
        { error: err, apiKeyId: apiKey.id },
        'Failed to update API key usage',
      )
    })

  return {
    valid: true,
    apiKey: {
      id: apiKey.id,
      userId: apiKey.userId,
      name: apiKey.name,
      scopes: apiKey.scopes,
      customRateLimit: apiKey.customRateLimit,
      ipWhitelist: apiKey.ipWhitelist,
      user: apiKey.user,
    },
  }
}

/**
 * Revoke an API key
 * Soft delete - marks as revoked but keeps in database for audit trail
 */
export async function revokeApiKey(
  apiKeyId: string,
  userId: string,
): Promise<boolean> {
  const result = await prisma.apiKey.updateMany({
    where: {
      id: apiKeyId,
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  })

  if (result.count > 0) {
    logger.info({ apiKeyId, userId }, 'API key revoked')
    return true
  }

  return false
}

/**
 * Get all API keys for a user
 * Returns safe info (no full keys!)
 */
export async function getUserApiKeys(userId: string) {
  return prisma.apiKey.findMany({
    where: {
      userId,
      revokedAt: null,
    },
    select: {
      id: true,
      name: true,
      description: true,
      keyPrefix: true, // Safe to show
      environment: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      usageCount: true,
      customRateLimit: true,
      ipWhitelist: true,
      scopes: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  })
}

/**
 * Get usage statistics for an API key
 */
export async function getApiKeyUsageStats(apiKeyId: string, userId: string) {
  // Verify ownership
  const apiKey = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, userId },
  })

  if (!apiKey) {
    throw new Error('API key not found')
  }

  // Get usage stats from logs
  const [totalRequests, successfulRequests, failedRequests, totalCreditsUsed] =
    await Promise.all([
      prisma.apiKeyUsageLog.count({
        where: { apiKeyId },
      }),
      prisma.apiKeyUsageLog.count({
        where: { apiKeyId, statusCode: { gte: 200, lt: 300 } },
      }),
      prisma.apiKeyUsageLog.count({
        where: { apiKeyId, statusCode: { gte: 400 } },
      }),
      prisma.apiKeyUsageLog.aggregate({
        where: { apiKeyId },
        _sum: { creditsUsed: true },
      }),
    ])

  return {
    totalRequests,
    successfulRequests,
    failedRequests,
    totalCreditsUsed: totalCreditsUsed._sum.creditsUsed || 0,
    successRate:
      totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0,
  }
}
