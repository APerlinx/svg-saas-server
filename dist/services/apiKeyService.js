"use strict";
/**
 * API Key Service
 * Handles creation, validation, and management of API keys
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSecureKey = generateSecureKey;
exports.hashApiKey = hashApiKey;
exports.getKeyPrefix = getKeyPrefix;
exports.createApiKey = createApiKey;
exports.validateApiKey = validateApiKey;
exports.revokeApiKey = revokeApiKey;
exports.getUserApiKeys = getUserApiKeys;
exports.getApiKeyUsageStats = getApiKeyUsageStats;
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = require("../lib/logger");
const planLimits_1 = require("../utils/planLimits");
/**
 * Generate a secure API key
 * Format: sk_{env}_{32_random_bytes}
 *
 * Example: sk_live_abc123def456...
 */
function generateSecureKey(environment = 'production') {
    const prefix = environment === 'production' ? 'sk_live' : 'sk_test';
    const randomBytes = crypto_1.default.randomBytes(24).toString('hex'); // 48 chars
    return `${prefix}_${randomBytes}`;
}
/**
 * Hash an API key using SHA-256
 * We NEVER store the raw key, only the hash
 */
function hashApiKey(rawKey) {
    return crypto_1.default.createHash('sha256').update(rawKey).digest('hex');
}
/**
 * Get the display prefix of a key (first 12 chars + ****)
 * Example: sk_live_abc1****
 */
function getKeyPrefix(rawKey) {
    if (rawKey.length < 12)
        return rawKey;
    return `${rawKey.substring(0, 12)}****`;
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
async function createApiKey(params) {
    const { userId, name, description, environment, customRateLimit, ipWhitelist, expiresAt, } = params;
    // 1. Get user and check plan
    const user = await prisma_1.default.user.findUnique({
        where: { id: userId },
        select: { plan: true },
    });
    if (!user) {
        throw new Error('User not found');
    }
    const planLimits = planLimits_1.PLAN_LIMITS[user.plan];
    // 2. Check if plan allows API access
    if (!planLimits.apiAccess) {
        throw new Error('API access requires PRO or ENTERPRISE plan');
    }
    // 3. Check current key count
    const currentKeyCount = await prisma_1.default.apiKey.count({
        where: {
            userId,
            revokedAt: null, // Only count active keys
        },
    });
    if (currentKeyCount >= planLimits.maxApiKeys) {
        throw new Error(`Maximum API keys reached. Your plan allows ${planLimits.maxApiKeys} keys.`);
    }
    // 4. Generate secure key
    const rawKey = generateSecureKey(environment || 'production');
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = getKeyPrefix(rawKey);
    // 5. Create API key in database
    const apiKey = await prisma_1.default.apiKey.create({
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
    });
    logger_1.logger.info({ userId, apiKeyId: apiKey.id, keyPrefix, environment: apiKey.environment }, 'API key created');
    return {
        id: apiKey.id,
        rawKey, // ⚠️ Only returned once at creation
        keyPrefix,
        name: apiKey.name,
        createdAt: apiKey.createdAt,
    };
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
async function validateApiKey(rawKey, ipAddress) {
    // Hash the provided key
    const keyHash = hashApiKey(rawKey);
    // Find the key with user info
    const apiKey = await prisma_1.default.apiKey.findUnique({
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
    });
    // Key doesn't exist
    if (!apiKey) {
        return { valid: false, reason: 'Invalid API key' };
    }
    // Key is revoked
    if (apiKey.revokedAt) {
        return { valid: false, reason: 'API key has been revoked' };
    }
    // Key is expired
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        return { valid: false, reason: 'API key has expired' };
    }
    if (apiKey.ipWhitelist.length > 0 && ipAddress) {
        if (!apiKey.ipWhitelist.includes(ipAddress)) {
            logger_1.logger.warn({ apiKeyId: apiKey.id, ipAddress, whitelist: apiKey.ipWhitelist }, 'API key used from non-whitelisted IP');
            return { valid: false, reason: 'IP address not whitelisted' };
        }
    }
    // Update usage statistics asynchronously
    prisma_1.default.apiKey
        .update({
        where: { id: apiKey.id },
        data: {
            lastUsedAt: new Date(),
            usageCount: { increment: 1 },
        },
    })
        .catch((err) => {
        logger_1.logger.error({ error: err, apiKeyId: apiKey.id }, 'Failed to update API key usage');
    });
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
    };
}
/**
 * Revoke an API key
 * Soft delete - marks as revoked but keeps in database for audit trail
 */
async function revokeApiKey(apiKeyId, userId) {
    const result = await prisma_1.default.apiKey.updateMany({
        where: {
            id: apiKeyId,
            userId,
            revokedAt: null,
        },
        data: {
            revokedAt: new Date(),
        },
    });
    if (result.count > 0) {
        logger_1.logger.info({ apiKeyId, userId }, 'API key revoked');
        return true;
    }
    return false;
}
/**
 * Get all API keys for a user
 * Returns safe info (no full keys!)
 */
async function getUserApiKeys(userId) {
    return prisma_1.default.apiKey.findMany({
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
    });
}
/**
 * Get usage statistics for an API key
 */
async function getApiKeyUsageStats(apiKeyId, userId) {
    // Verify ownership
    const apiKey = await prisma_1.default.apiKey.findFirst({
        where: { id: apiKeyId, userId },
    });
    if (!apiKey) {
        throw new Error('API key not found');
    }
    // Get usage stats from logs
    const [totalRequests, successfulRequests, failedRequests, totalCreditsUsed] = await Promise.all([
        prisma_1.default.apiKeyUsageLog.count({
            where: { apiKeyId },
        }),
        prisma_1.default.apiKeyUsageLog.count({
            where: { apiKeyId, statusCode: { gte: 200, lt: 300 } },
        }),
        prisma_1.default.apiKeyUsageLog.count({
            where: { apiKeyId, statusCode: { gte: 400 } },
        }),
        prisma_1.default.apiKeyUsageLog.aggregate({
            where: { apiKeyId },
            _sum: { creditsUsed: true },
        }),
    ]);
    return {
        totalRequests,
        successfulRequests,
        failedRequests,
        totalCreditsUsed: totalCreditsUsed._sum.creditsUsed || 0,
        successRate: totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0,
    };
}
