"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.monthlyGenerationQuota = monthlyGenerationQuota;
exports.incrementGenerationQuota = incrementGenerationQuota;
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = require("../lib/logger");
const planLimits_1 = require("../utils/planLimits");
const getUserId_1 = require("../utils/getUserId");
const env_1 = require("../config/env");
/**
 * Check if user has exceeded their monthly generation quota
 * Must run AFTER authentication middleware (requires req.user)
 *
 * @param options Configuration options
 * @param options.skipCheck If true, skip quota check but still attach quota info (useful for GET endpoints)
 */
function monthlyGenerationQuota(options) {
    // Bypass in test environment
    if (env_1.IS_TEST) {
        return (req, res, next) => next();
    }
    return async (req, res, next) => {
        var _a, _b;
        try {
            const userId = (0, getUserId_1.getUserId)(req);
            if (!userId) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }
            const now = new Date();
            // Fetch user quota information
            const user = await prisma_1.default.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    plan: true,
                    generationsQuotaUsed: true,
                    generationsQuotaLimit: true,
                    generationsQuotaResetAt: true,
                },
            });
            if (!user) {
                res.status(401).json({ error: 'User not found' });
                return;
            }
            const planLimits = planLimits_1.PLAN_LIMITS[user.plan];
            const quotaLimit = (_a = user.generationsQuotaLimit) !== null && _a !== void 0 ? _a : planLimits.generationsPerMonth;
            const quotaUsed = (_b = user.generationsQuotaUsed) !== null && _b !== void 0 ? _b : 0;
            const resetAt = user.generationsQuotaResetAt;
            // Check if quota needs reset (30-day rolling window)
            const needsReset = !resetAt || now >= resetAt;
            if (needsReset) {
                // Reset quota for new billing period
                const nextResetAt = new Date(now);
                nextResetAt.setDate(nextResetAt.getDate() + 30);
                await prisma_1.default.user.update({
                    where: { id: userId },
                    data: {
                        generationsQuotaUsed: 0,
                        generationsQuotaLimit: quotaLimit,
                        generationsQuotaResetAt: nextResetAt,
                    },
                });
                logger_1.logger.info({
                    userId,
                    plan: user.plan,
                    quotaLimit,
                    nextResetAt,
                }, 'Generation quota reset for new billing period');
                // Attach fresh quota info to request
                req.quotaInfo = {
                    limit: quotaLimit,
                    used: 0,
                    remaining: quotaLimit,
                    resetAt: nextResetAt,
                    resetsInDays: 30,
                };
                next();
                return;
            }
            // Calculate remaining quota
            const remaining = Math.max(0, quotaLimit - quotaUsed);
            const daysUntilReset = Math.ceil((resetAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            // Attach quota info to request for response headers / logging
            req.quotaInfo = {
                limit: quotaLimit,
                used: quotaUsed,
                remaining,
                resetAt,
                resetsInDays: daysUntilReset,
            };
            // Skip check if this is a read-only endpoint (e.g., GET job status)
            if (options === null || options === void 0 ? void 0 : options.skipCheck) {
                next();
                return;
            }
            // Check if quota exceeded
            if (quotaUsed >= quotaLimit) {
                logger_1.logger.warn({
                    userId,
                    plan: user.plan,
                    quotaUsed,
                    quotaLimit,
                    resetAt,
                }, 'Generation quota exceeded');
                res.status(429).json({
                    error: 'Monthly generation quota exceeded',
                    message: `You have used ${quotaUsed} of ${quotaLimit} generations this month. Your quota resets in ${daysUntilReset} days.`,
                    quota: {
                        limit: quotaLimit,
                        used: quotaUsed,
                        remaining: 0,
                        resetAt: resetAt.toISOString(),
                        resetsIn: `${daysUntilReset} ${daysUntilReset === 1 ? 'day' : 'days'}`,
                    },
                });
                return;
            }
            next();
        }
        catch (error) {
            logger_1.logger.error({
                error,
                userId: (0, getUserId_1.getUserId)(req),
                path: req.path,
            }, 'Generation quota check failed');
            res.status(500).json({
                error: 'Quota check failed',
                message: 'An error occurred while checking generation quota',
            });
        }
    };
}
/**
 * Increment user's generation quota usage
 * Should be called after successful generation (web or API)
 *
 * @param userId User ID to increment quota for
 */
async function incrementGenerationQuota(userId) {
    try {
        await prisma_1.default.user.update({
            where: { id: userId },
            data: {
                generationsQuotaUsed: { increment: 1 },
            },
        });
        logger_1.logger.debug({ userId }, 'Generation quota incremented');
    }
    catch (error) {
        // Log error but don't throw - quota tracking should not block generation
        logger_1.logger.error({
            error,
            userId,
        }, 'Failed to increment generation quota (non-blocking)');
    }
}
