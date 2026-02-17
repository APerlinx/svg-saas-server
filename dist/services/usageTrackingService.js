"use strict";
/**
 * Usage Tracking Service
 * Logs API requests for analytics, billing, and monitoring
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logApiUsage = logApiUsage;
exports.incrementApiQuota = incrementApiQuota;
exports.getUserUsageSummary = getUserUsageSummary;
exports.getEndpointUsageBreakdown = getEndpointUsageBreakdown;
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = require("../lib/logger");
/**
 * Log an API request to the usage log
 * Called after each API request completes
 */
async function logApiUsage(params) {
    var _a, _b;
    try {
        await prisma_1.default.apiKeyUsageLog.create({
            data: {
                apiKeyId: params.apiKeyId,
                userId: params.userId,
                endpoint: params.endpoint,
                method: params.method,
                statusCode: params.statusCode,
                timestamp: new Date(),
                latencyMs: params.latencyMs,
                creditsUsed: (_a = params.creditsUsed) !== null && _a !== void 0 ? _a : 0,
                tokensUsed: (_b = params.tokensUsed) !== null && _b !== void 0 ? _b : 0,
            },
        });
    }
    catch (error) {
        logger_1.logger.error({
            error,
            apiKeyId: params.apiKeyId,
            endpoint: params.endpoint,
        }, 'Failed to log API usage');
    }
}
/**
 * Increment user's API quota usage
 * Called after successful API request
 */
async function incrementApiQuota(userId) {
    try {
        await prisma_1.default.user.update({
            where: { id: userId },
            data: {
                apiQuotaUsed: { increment: 1 },
            },
        });
    }
    catch (error) {
        logger_1.logger.error({
            error,
            userId,
        }, 'Failed to increment API quota');
    }
}
/**
 * Get API usage summary for a user
 */
async function getUserUsageSummary(userId, startDate, endDate) {
    const where = { userId };
    if (startDate || endDate) {
        where.timestamp = {};
        if (startDate)
            where.timestamp.gte = startDate;
        if (endDate)
            where.timestamp.lte = endDate;
    }
    const [totalRequests, successfulRequests, totalCredits, avgLatency] = await Promise.all([
        prisma_1.default.apiKeyUsageLog.count({ where }),
        prisma_1.default.apiKeyUsageLog.count({
            where: { ...where, statusCode: { gte: 200, lt: 300 } },
        }),
        prisma_1.default.apiKeyUsageLog.aggregate({
            where,
            _sum: { creditsUsed: true },
        }),
        prisma_1.default.apiKeyUsageLog.aggregate({
            where,
            _avg: { latencyMs: true },
        }),
    ]);
    return {
        totalRequests,
        successfulRequests,
        failedRequests: totalRequests - successfulRequests,
        totalCreditsUsed: totalCredits._sum.creditsUsed || 0,
        averageLatencyMs: Math.round(avgLatency._avg.latencyMs || 0),
        successRate: totalRequests > 0
            ? Math.round((successfulRequests / totalRequests) * 100)
            : 0,
    };
}
/**
 * Get usage breakdown by endpoint
 */
async function getEndpointUsageBreakdown(userId, startDate, endDate) {
    const where = { userId };
    if (startDate || endDate) {
        where.timestamp = {};
        if (startDate)
            where.timestamp.gte = startDate;
        if (endDate)
            where.timestamp.lte = endDate;
    }
    const usage = await prisma_1.default.apiKeyUsageLog.groupBy({
        by: ['endpoint', 'method'],
        where,
        _count: { id: true },
        _sum: { creditsUsed: true },
        _avg: { latencyMs: true },
        orderBy: {
            _count: {
                id: 'desc',
            },
        },
    });
    return usage.map((item) => ({
        endpoint: item.endpoint,
        method: item.method,
        requests: item._count.id,
        creditsUsed: item._sum.creditsUsed || 0,
        avgLatencyMs: Math.round(item._avg.latencyMs || 0),
    }));
}
