"use strict";
/**
 * Unified Rate Limiting Middleware
 *
 * Supports two modes:
 * 1. Fixed rate limits (IP or custom key based) - for auth, downloads, etc.
 * 2. Plan-based rate limits (user-specific based on subscription) - for API
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportMessageLimiter = exports.downloadLimiter = exports.svgGenerationLimiter = exports.apiLimiter = exports.forgotPasswordLimiter = exports.authLimiter = exports.createRateLimiter = void 0;
exports.createPlanRateLimiter = createPlanRateLimiter;
exports.getRateLimitStatus = getRateLimitStatus;
const redis_1 = require("../lib/redis");
const env_1 = require("../config/env");
const logger_1 = require("../lib/logger");
const planLimits_1 = require("../utils/planLimits");
const prisma_1 = __importDefault(require("../lib/prisma"));
const Sentry = __importStar(require("@sentry/node"));
// Lua script for atomic rate limit operations
const RATE_LIMIT_LUA = `
  local key = KEYS[1]              
  local window = tonumber(ARGV[1]) 
  local limit = tonumber(ARGV[2])  
  
  local current = redis.call('GET', key)
  
  if current and tonumber(current) >= limit then
    local ttl = redis.call('TTL', key)
    return {0, ttl}
  end
  
  local count = redis.call('INCR', key)
  
  if count == 1 then
    redis.call('EXPIRE', key, window)
  end
  
  local ttl = redis.call('TTL', key)     
  local remaining = limit - count         
  
  return {remaining, ttl}
`;
/**
 * Get user ID from request (supports session and API key auth)
 */
function getUserId(req) {
    var _a;
    // Session auth (web app)
    if (req.user) {
        if ('id' in req.user) {
            return req.user.id;
        }
        if ('userId' in req.user) {
            return req.user.userId;
        }
    }
    // API key auth (public API)
    if ((_a = req.apiUser) === null || _a === void 0 ? void 0 : _a.id) {
        return req.apiUser.id;
    }
    return null;
}
/**
 * Get hour-based window key for plan rate limiting
 * Format: ratelimit:plan:userId:2026-02-16-14
 */
function getPlanRateLimitKey(userId) {
    const now = new Date();
    const hourWindow = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}`;
    return `ratelimit:plan:${userId}:${hourWindow}`;
}
/**
 * Get when current hour window ends
 */
function getHourWindowReset() {
    const now = new Date();
    const reset = new Date(now);
    reset.setUTCMinutes(0, 0, 0);
    reset.setUTCHours(reset.getUTCHours() + 1);
    return reset;
}
/**
 * Fixed rate limiter (IP or custom key based)
 * Used for auth, downloads, support, etc.
 */
const createRateLimiter = (options) => {
    const { windowMs, max, message, keyPrefix, keyGenerator } = options;
    const windowSeconds = Math.floor(windowMs / 1000);
    return async (req, res, next) => {
        if (env_1.IS_TEST) {
            return next();
        }
        try {
            if (!redis_1.redisClient.isOpen) {
                logger_1.logger.warn('Redis not connected, skipping rate limit');
                return next();
            }
            const identifier = keyGenerator ? keyGenerator(req) : req.ip || 'unknown';
            const key = `${keyPrefix}:${identifier}`;
            const result = (await redis_1.redisClient.eval(RATE_LIMIT_LUA, {
                keys: [key],
                arguments: [windowSeconds.toString(), max.toString()],
            }));
            const [remaining, ttl] = result;
            res.setHeader('X-RateLimit-Limit', max.toString());
            res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining).toString());
            res.setHeader('X-RateLimit-Reset', (Date.now() + ttl * 1000).toString());
            if (remaining <= 0) {
                res.setHeader('Retry-After', ttl.toString());
                logger_1.logger.warn({
                    key,
                    identifier,
                    limit: max,
                    ttl,
                    ip: req.ip,
                    userAgent: req.get('user-agent'),
                    path: req.path,
                    method: req.method,
                    requestId: req.requestId,
                }, 'Rate limit exceeded');
                // Alert on excessive violations in production
                if (env_1.IS_PRODUCTION && process.env.SENTRY_DSN) {
                    Sentry.captureMessage('Rate limit exceeded', {
                        level: 'warning',
                        tags: {
                            rate_limit: keyPrefix,
                            ip: identifier,
                            path: req.path,
                        },
                        extra: {
                            limit: max,
                            windowMs,
                            userAgent: req.get('user-agent'),
                        },
                    });
                }
                return res.status(429).json({ error: message });
            }
            next();
        }
        catch (error) {
            logger_1.logger.error({ error }, 'Rate limiter error, allowing request');
            next();
        }
    };
};
exports.createRateLimiter = createRateLimiter;
/**
 * Plan-based rate limiter (user subscription tier based)
 * Used for authenticated API endpoints - enforces plan limits
 */
function createPlanRateLimiter(options = {}) {
    return async (req, res, next) => {
        if (env_1.IS_TEST) {
            return next();
        }
        try {
            const userId = getUserId(req);
            // Skip if not authenticated and skipAuth is true
            if (!userId && options.skipAuth) {
                return next();
            }
            // Require authentication
            if (!userId) {
                return res.status(401).json({
                    error: 'Authentication required',
                    message: 'Rate limiting requires authentication',
                });
            }
            if (!redis_1.redisClient.isOpen) {
                logger_1.logger.warn('Redis not connected, skipping plan rate limit');
                return next();
            }
            // Fetch user's plan
            const user = await prisma_1.default.user.findUnique({
                where: { id: userId },
                select: { plan: true },
            });
            if (!user) {
                return res.status(404).json({
                    error: 'User not found',
                    message: 'Unable to determine rate limits',
                });
            }
            // Get plan limits
            const planLimits = (0, planLimits_1.getPlanLimits)(user.plan);
            const requestsPerHour = planLimits.rateLimits.perHour;
            // Get Redis key for current hour window
            const key = getPlanRateLimitKey(userId);
            const resetAt = getHourWindowReset();
            // Increment request count atomically
            const currentCount = await redis_1.redisClient.incr(key);
            // Set expiry on first request (1 hour)
            if (currentCount === 1) {
                await redis_1.redisClient.expire(key, 3600);
            }
            const remaining = Math.max(0, requestsPerHour - currentCount);
            const rateLimitInfo = {
                limit: requestsPerHour,
                used: currentCount,
                remaining,
                resetAt,
            };
            // Attach to request
            req.rateLimitInfo = rateLimitInfo;
            // Set headers
            res.setHeader('X-RateLimit-Limit', requestsPerHour.toString());
            res.setHeader('X-RateLimit-Remaining', remaining.toString());
            res.setHeader('X-RateLimit-Reset', resetAt.toISOString());
            // Check if exceeded
            if (currentCount > requestsPerHour) {
                const retryAfter = Math.ceil((resetAt.getTime() - Date.now()) / 1000);
                rateLimitInfo.retryAfter = retryAfter;
                res.setHeader('Retry-After', retryAfter.toString());
                logger_1.logger.warn({
                    userId,
                    plan: user.plan,
                    limit: requestsPerHour,
                    used: currentCount,
                    path: req.path,
                    method: req.method,
                }, 'Plan rate limit exceeded');
                return res.status(429).json({
                    error: 'Rate limit exceeded',
                    message: `You have exceeded the rate limit of ${requestsPerHour} requests per hour. Please try again later.`,
                    rateLimit: rateLimitInfo,
                });
            }
            logger_1.logger.debug({
                userId,
                plan: user.plan,
                used: currentCount,
                limit: requestsPerHour,
                remaining,
            }, 'Plan rate limit check passed');
            next();
        }
        catch (error) {
            logger_1.logger.error({
                error,
                userId: getUserId(req),
                path: req.path,
            }, 'Plan rate limit check failed');
            // Fail open - don't block requests if rate limiting fails
            logger_1.logger.warn('Plan rate limiting failed - allowing request to proceed');
            next();
        }
    };
}
/**
 * Get current rate limit status for a user
 */
async function getRateLimitStatus(userId) {
    try {
        const user = await prisma_1.default.user.findUnique({
            where: { id: userId },
            select: { plan: true },
        });
        if (!user) {
            return null;
        }
        const planLimits = (0, planLimits_1.getPlanLimits)(user.plan);
        const requestsPerHour = planLimits.rateLimits.perHour;
        const key = getPlanRateLimitKey(userId);
        const resetAt = getHourWindowReset();
        const currentCount = await redis_1.redisClient.get(key);
        const used = currentCount ? parseInt(currentCount, 10) : 0;
        const remaining = Math.max(0, requestsPerHour - used);
        return {
            limit: requestsPerHour,
            used,
            remaining,
            resetAt,
        };
    }
    catch (error) {
        logger_1.logger.error({ error, userId }, 'Failed to get rate limit status');
        return null;
    }
}
// =============================================================================
// Pre-configured rate limiters for common use cases
// =============================================================================
/**
 * Auth endpoints (login, register, OAuth)
 * 5 attempts per IP per 15 minutes
 */
exports.authLimiter = (0, exports.createRateLimiter)({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many authentication attempts. Please try again later.',
    keyPrefix: 'rl:auth',
});
/**
 * Password reset endpoints
 * 3 attempts per IP per 15 minutes
 */
exports.forgotPasswordLimiter = (0, exports.createRateLimiter)({
    windowMs: 15 * 60 * 1000,
    max: 3,
    message: 'Too many password reset requests. Please try again later.',
    keyPrefix: 'rl:forgot',
});
/**
 * General API endpoints (legacy, for backward compatibility)
 * 100 requests per IP per 15 minutes
 */
exports.apiLimiter = (0, exports.createRateLimiter)({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests. Please try again later.',
    keyPrefix: 'rl:api',
});
/**
 * SVG generation in web app (user-based)
 * 10 generations per user per hour
 */
exports.svgGenerationLimiter = (0, exports.createRateLimiter)({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Generation limit reached. Please try again later.',
    keyPrefix: 'rl:svg',
    keyGenerator: (req) => {
        const userId = getUserId(req);
        return userId || req.ip || 'unknown';
    },
});
/**
 * Download endpoints (user-based)
 * 20 downloads per user per minute
 */
exports.downloadLimiter = (0, exports.createRateLimiter)({
    windowMs: 60 * 1000,
    max: 20,
    message: 'Too many download requests. Please try again later.',
    keyPrefix: 'rl:download',
    keyGenerator: (req) => {
        const userId = getUserId(req);
        return userId || req.ip || 'unknown';
    },
});
/**
 * Support message endpoints
 * 5 submissions per IP per 10 minutes
 */
exports.supportMessageLimiter = (0, exports.createRateLimiter)({
    windowMs: 10 * 60 * 1000,
    max: 5,
    message: 'Too many support messages. Please try again later.',
    keyPrefix: 'rl:support',
});
