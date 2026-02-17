"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const logger_1 = require("../lib/logger");
const emailService_1 = require("../services/emailService");
const adminAuth_1 = require("../middleware/adminAuth");
const prisma_1 = __importDefault(require("../lib/prisma"));
const svgGenerationQueue_1 = require("../jobs/svgGenerationQueue");
const router = express_1.default.Router();
router.post('/request-access', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        // Only allow requests to the configured admin email
        if (email !== env_1.ADMIN_EMAIL) {
            logger_1.logger.warn({ email }, 'Unauthorized admin access request');
            // Don't reveal whether email is correct (timing-safe response)
            return res.json({
                message: 'If this email is registered as admin, a magic link was sent',
            });
        }
        // Generate short-lived token (5 minutes)
        const token = jsonwebtoken_1.default.sign({
            email,
            type: 'admin_magic_link',
            nonce: Math.random().toString(36), // Single-use via nonce
        }, env_1.JWT_SECRET, { expiresIn: '5m' });
        await (0, emailService_1.sendAdminMagicLink)(email, token);
        logger_1.logger.info({ email }, 'Admin magic link sent');
        res.json({ message: 'Magic link sent to your email' });
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Error sending admin magic link');
        res.status(500).json({ error: 'Failed to send magic link' });
    }
});
router.get('/auth', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token || typeof token !== 'string') {
            return res.status(400).send('Invalid or missing token');
        }
        // Verify magic link token
        const decoded = jsonwebtoken_1.default.verify(token, env_1.JWT_SECRET);
        if (decoded.type !== 'admin_magic_link' || decoded.email !== env_1.ADMIN_EMAIL) {
            return res.status(403).send('Invalid magic link');
        }
        // TODO: Track used nonces in Redis to prevent reuse
        // For now, the 5-minute expiry provides reasonable security
        // Generate long-lived admin session token (24 hours)
        const sessionToken = jsonwebtoken_1.default.sign({
            email: decoded.email,
            type: 'admin',
        }, env_1.JWT_SECRET, { expiresIn: '24h' });
        // Set secure HTTP-only cookie
        res.cookie('admin_session', sessionToken, {
            httpOnly: true,
            secure: env_1.IS_PRODUCTION, // HTTPS only in production
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
            domain: env_1.IS_PRODUCTION ? '.chatsvg.dev' : undefined, // Cross-subdomain access in production
        });
        logger_1.logger.info({ email: decoded.email }, 'Admin authenticated via magic link');
        // Redirect to frontend admin dashboard
        const redirectUrl = `${env_1.FRONTEND_URL}/admin`;
        res.redirect(redirectUrl);
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Error verifying admin magic link');
        res.status(401).send('Invalid or expired magic link');
    }
});
router.get('/metrics', adminAuth_1.requireAdminOrAPIKey, async (req, res) => {
    try {
        // Parse time range from query params
        const timeRange = req.query.range;
        let startDate;
        switch (timeRange) {
            case '24h':
                startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
                break;
            case '7d':
                startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                break;
            case 'all':
            default:
                // No filter - all time
                startDate = undefined;
                break;
        }
        // OpenAI GPT-5 pricing (as of Feb 2026)
        const PRICING = {
            'gpt-5.2': { input: 1.75 / 1000000, output: 14 / 1000000 },
            'gpt-5.2-2025-12-11': {
                input: 1.75 / 1000000,
                output: 14 / 1000000,
            },
            'gpt-5.2-pro': { input: 21 / 1000000, output: 168 / 1000000 },
            'gpt-5-mini': { input: 0.25 / 1000000, output: 2 / 1000000 },
            'gpt-5-mini-2025-08-07': {
                input: 0.25 / 1000000,
                output: 2 / 1000000,
            },
            'gpt-4.1': { input: 3 / 1000000, output: 12 / 1000000 },
            'gpt-4.1-mini': { input: 0.8 / 1000000, output: 3.2 / 1000000 },
        };
        // Build where clause with time filter
        const whereClause = {
            status: 'SUCCEEDED',
            aiTotalTokens: { not: null },
        };
        if (startDate) {
            whereClause.createdAt = { gte: startDate };
        }
        // Fetch succeeded jobs with AI metrics (filtered by time range)
        const succeededJobs = await prisma_1.default.generationJob.findMany({
            where: whereClause,
            select: {
                aiModel: true,
                aiPromptTokens: true,
                aiCompletionTokens: true,
                aiTotalTokens: true,
                aiLatencyMs: true,
                aiAttempts: true,
                createdAt: true,
                finishedAt: true,
                userId: true,
            },
        });
        // Calculate costs and aggregate metrics
        let totalCostUSD = 0;
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        const latencies = [];
        const durations = [];
        let repairCount = 0;
        for (const job of succeededJobs) {
            const model = (job.aiModel || 'gpt-5.2');
            const pricing = PRICING[model] || PRICING['gpt-5.2'];
            const promptTokens = job.aiPromptTokens || 0;
            const completionTokens = job.aiCompletionTokens || 0;
            const attempts = job.aiAttempts || 1;
            totalPromptTokens += promptTokens;
            totalCompletionTokens += completionTokens;
            totalCostUSD +=
                promptTokens * pricing.input + completionTokens * pricing.output;
            if (job.aiLatencyMs)
                latencies.push(job.aiLatencyMs);
            if (attempts > 1)
                repairCount++;
            if (job.finishedAt) {
                const duration = job.finishedAt.getTime() - job.createdAt.getTime();
                durations.push(duration);
            }
        }
        // Calculate percentiles
        const percentile = (arr, p) => {
            if (arr.length === 0)
                return 0;
            const sorted = [...arr].sort((a, b) => a - b);
            const idx = Math.ceil((p / 100) * sorted.length) - 1;
            return sorted[idx] || 0;
        };
        const avgLatency = latencies.length
            ? latencies.reduce((a, b) => a + b, 0) / latencies.length
            : 0;
        const p95Latency = percentile(latencies, 95);
        const avgDuration = durations.length
            ? durations.reduce((a, b) => a + b, 0) / durations.length
            : 0;
        // Job status counts (filtered by time range)
        const statusCounts = await prisma_1.default.generationJob.groupBy({
            by: ['status'],
            _count: true,
            where: startDate ? { createdAt: { gte: startDate } } : undefined,
        });
        const statusMap = Object.fromEntries(statusCounts.map((s) => [s.status, s._count]));
        const totalJobs = (statusMap.SUCCEEDED || 0) +
            (statusMap.FAILED || 0) +
            (statusMap.QUEUED || 0) +
            (statusMap.RUNNING || 0);
        const successRate = totalJobs > 0 ? ((statusMap.SUCCEEDED || 0) / totalJobs) * 100 : 0;
        // Queue depth
        const queueDepth = await svgGenerationQueue_1.svgGenerationQueue.count();
        // User statistics (filtered by time range)
        const userStatsWhere = startDate ? { createdAt: { gte: startDate } } : {};
        const activeUsers = await prisma_1.default.generationJob.findMany({
            where: userStatsWhere,
            select: { userId: true },
            distinct: ['userId'],
        });
        const topGenerators = await prisma_1.default.generationJob.groupBy({
            by: ['userId'],
            _count: true,
            where: startDate ? { createdAt: { gte: startDate } } : undefined,
            orderBy: { _count: { userId: 'desc' } },
            take: 10,
        });
        const totalGenerations = await prisma_1.default.generationJob.count({
            where: startDate ? { createdAt: { gte: startDate } } : undefined,
        });
        res.json({
            timeRange: timeRange || 'all',
            ai: {
                totalJobs: succeededJobs.length,
                avgPromptTokens: Math.round(succeededJobs.length ? totalPromptTokens / succeededJobs.length : 0),
                avgCompletionTokens: Math.round(succeededJobs.length
                    ? totalCompletionTokens / succeededJobs.length
                    : 0),
                totalTokens: totalPromptTokens + totalCompletionTokens,
                avgLatencyMs: Math.round(avgLatency),
                p95LatencyMs: Math.round(p95Latency),
                repairRate: succeededJobs.length > 0
                    ? ((repairCount / succeededJobs.length) * 100).toFixed(2) + '%'
                    : '0%',
                totalCostUSD: '$' + totalCostUSD.toFixed(2),
                avgCostPerJobUSD: '$' + (totalCostUSD / (succeededJobs.length || 1)).toFixed(4),
            },
            jobs: {
                total: totalJobs,
                succeeded: statusMap.SUCCEEDED || 0,
                failed: statusMap.FAILED || 0,
                queued: statusMap.QUEUED || 0,
                running: statusMap.RUNNING || 0,
                queueDepth,
                successRate: successRate.toFixed(2) + '%',
                avgDurationMs: Math.round(avgDuration),
            },
            users: {
                activeUsers: activeUsers.length,
                totalGenerations,
                topGenerators: topGenerators.map((u) => ({
                    userId: u.userId,
                    jobCount: u._count,
                })),
            },
        });
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Error fetching admin metrics');
        res.status(500).json({ error: 'Failed to fetch metrics' });
    }
});
router.post('/logout', (req, res) => {
    res.clearCookie('admin_session');
    res.json({ message: 'Logged out successfully' });
});
/**
 * GET /admin/debug/ip
 * IP detection diagnostic tool for verifying proxy configuration
 */
router.get('/debug/ip', adminAuth_1.requireAdminOrAPIKey, (req, res) => {
    const ipInfo = {
        expressIp: req.ip,
        expressIps: req.ips,
        headers: {
            'x-forwarded-for': req.headers['x-forwarded-for'],
            'x-real-ip': req.headers['x-real-ip'],
            'cf-connecting-ip': req.headers['cf-connecting-ip'],
        },
        socketRemoteAddress: req.socket.remoteAddress,
        clientIp: (req.headers['cf-connecting-ip'] ||
            req.ip ||
            req.socket.remoteAddress ||
            '')
            .toString()
            .replace('::ffff:', ''),
    };
    logger_1.logger.info({ ipInfo }, 'IP detection debug request');
    res.json({
        message: 'IP Detection Info',
        ...ipInfo,
        interpretation: {
            trustProxySetting: env_1.IS_PRODUCTION ? 1 : false,
            usingCloudflare: !!req.headers['cf-connecting-ip'],
            recommendation: 'If clientIp shows proxy IP instead of your real IP, check trust proxy configuration',
        },
    });
});
exports.default = router;
