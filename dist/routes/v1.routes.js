"use strict";
/**
 * Public API Routes (v1)
 * External API endpoints for developers to generate SVGs programmatically
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const apiKeyAuth_1 = require("../middleware/apiKeyAuth");
const monthlyGenerationQuota_1 = require("../middleware/monthlyGenerationQuota");
const rateLimiter_1 = require("../middleware/rateLimiter");
const creditRefillService_1 = require("../services/creditRefillService");
const svgGenerationService_1 = require("../services/svgGenerationService");
const usageTrackingService_1 = require("../services/usageTrackingService");
const logger_1 = require("../lib/logger");
const getUserId_1 = require("../utils/getUserId");
const rateLimitHeaders_1 = require("../utils/rateLimitHeaders");
const prisma_1 = __importDefault(require("../lib/prisma"));
const env_1 = require("../config/env");
const router = (0, express_1.Router)();
/**
 * POST /v1/svg/generate
 * Generate SVG from text prompt
 */
router.post('/svg/generate', apiKeyAuth_1.apiKeyAuth, (0, rateLimiter_1.createPlanRateLimiter)(), (0, monthlyGenerationQuota_1.monthlyGenerationQuota)(), async (req, res) => {
    const startTime = Date.now();
    const userId = (0, getUserId_1.requireUserId)(req);
    const apiKeyId = req.apiKey.id;
    try {
        // Process credit refill if due
        await (0, creditRefillService_1.processUserCreditRefill)(userId);
        // Validate request body
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({
                error: 'Invalid request body',
                message: 'Request body must be a valid JSON object',
            });
        }
        const { prompt, style, model, idempotencyKey } = req.body;
        const result = await (0, svgGenerationService_1.createGenerationJob)({
            userId,
            prompt,
            style,
            model,
            idempotencyKey,
            source: 'API',
            apiKeyId,
        });
        // Handle duplicate request
        if (result.status === 'duplicate') {
            (0, usageTrackingService_1.logApiUsage)({
                apiKeyId,
                userId,
                endpoint: '/v1/svg/generate',
                method: 'POST',
                statusCode: 200,
                latencyMs: Date.now() - startTime,
                creditsUsed: 0,
            }).catch((err) => logger_1.logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'));
            (0, rateLimitHeaders_1.setRateLimitHeaders)(req, res);
            return res.status(200).json({
                jobId: result.job.id,
                status: 'duplicate',
                duplicate: true,
                creditsCharged: false,
                message: 'Duplicate request detected. Returning existing job.',
            });
        }
        // Charge credits atomically
        const charged = await prisma_1.default.$transaction(async (tx) => {
            const debitResult = await tx.user.updateMany({
                where: { id: userId, credits: { gt: 0 } },
                data: { credits: { decrement: 1 } },
            });
            if (debitResult.count === 0)
                return false;
            await tx.generationJob.update({
                where: { id: result.job.id },
                data: { creditsCharged: true },
            });
            return true;
        });
        if (!charged) {
            await prisma_1.default.generationJob.update({
                where: { id: result.job.id },
                data: {
                    status: client_1.GenerationJobStatus.FAILED,
                    finishedAt: new Date(),
                    lastFailedAt: new Date(),
                    errorCode: 'INSUFFICIENT_CREDITS',
                    errorMessage: 'Insufficient credits to generate SVG',
                },
            });
            (0, usageTrackingService_1.logApiUsage)({
                apiKeyId,
                userId,
                endpoint: '/v1/svg/generate',
                method: 'POST',
                statusCode: 402,
                latencyMs: Date.now() - startTime,
                creditsUsed: 0,
            }).catch((err) => logger_1.logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'));
            (0, rateLimitHeaders_1.setRateLimitHeaders)(req, res);
            return res.status(402).json({
                error: 'Insufficient credits',
                message: 'You do not have enough credits to generate an SVG. Please purchase more credits.',
            });
        }
        // Enqueue job and refund on enqueue failure
        try {
            await (0, svgGenerationService_1.enqueueGenerationJob)(result.job.id, userId);
            await (0, monthlyGenerationQuota_1.incrementGenerationQuota)(userId);
        }
        catch (enqueueError) {
            logger_1.logger.error({
                error: enqueueError,
                jobId: result.job.id,
                userId,
                apiKeyId,
            }, 'Failed to enqueue SVG generation job');
            // Idempotent refund: only refund if not already refunded
            await prisma_1.default.$transaction(async (tx) => {
                const refundClaim = await tx.generationJob.updateMany({
                    where: {
                        id: result.job.id,
                        status: client_1.GenerationJobStatus.QUEUED,
                        creditsCharged: true,
                        creditsRefunded: false,
                        generationId: null,
                    },
                    data: {
                        status: client_1.GenerationJobStatus.FAILED,
                        errorCode: 'ENQUEUE_FAILED',
                        errorMessage: 'Failed to enqueue job.',
                        creditsRefunded: true,
                        finishedAt: new Date(),
                        lastFailedAt: new Date(),
                    },
                });
                if (refundClaim.count > 0) {
                    await tx.user.update({
                        where: { id: userId },
                        data: { credits: { increment: 1 } },
                    });
                    logger_1.logger.info({ jobId: result.job.id, userId }, 'Credit refunded after enqueue failure');
                }
            });
            throw enqueueError;
        }
        (0, usageTrackingService_1.logApiUsage)({
            apiKeyId,
            userId,
            endpoint: '/v1/svg/generate',
            method: 'POST',
            statusCode: 202,
            latencyMs: Date.now() - startTime,
            creditsUsed: 1,
        }).catch((err) => logger_1.logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'));
        (0, rateLimitHeaders_1.setRateLimitHeaders)(req, res);
        res.status(202).json({
            jobId: result.job.id,
            status: 'queued',
            creditsCharged: true,
            message: 'SVG generation job created successfully',
            estimatedCompletionTime: '30-60 seconds',
        });
    }
    catch (error) {
        // Handle validation errors
        if (error instanceof svgGenerationService_1.ValidationError) {
            (0, usageTrackingService_1.logApiUsage)({
                apiKeyId,
                userId,
                endpoint: '/v1/svg/generate',
                method: 'POST',
                statusCode: 400,
                latencyMs: Date.now() - startTime,
                creditsUsed: 0,
            }).catch((err) => logger_1.logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'));
            (0, rateLimitHeaders_1.setRateLimitHeaders)(req, res);
            return res.status(400).json({
                error: error.message,
            });
        }
        if (error instanceof svgGenerationService_1.ConflictError) {
            (0, usageTrackingService_1.logApiUsage)({
                apiKeyId,
                userId,
                endpoint: '/v1/svg/generate',
                method: 'POST',
                statusCode: 409,
                latencyMs: Date.now() - startTime,
                creditsUsed: 0,
            }).catch((err) => logger_1.logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'));
            (0, rateLimitHeaders_1.setRateLimitHeaders)(req, res);
            return res.status(409).json({
                error: error.message,
            });
        }
        // Handle not found errors
        if (error instanceof svgGenerationService_1.NotFoundError) {
            (0, usageTrackingService_1.logApiUsage)({
                apiKeyId,
                userId,
                endpoint: '/v1/svg/generate',
                method: 'POST',
                statusCode: 404,
                latencyMs: Date.now() - startTime,
                creditsUsed: 0,
            }).catch((err) => logger_1.logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'));
            (0, rateLimitHeaders_1.setRateLimitHeaders)(req, res);
            return res.status(404).json({
                error: error.message,
            });
        }
        logger_1.logger.error({
            error,
            userId,
            apiKeyId,
            endpoint: '/v1/svg/generate',
        }, 'API generation failed');
        const statusCode = error.statusCode || 500;
        const errorMessage = error.message || 'An error occurred while processing your request';
        (0, usageTrackingService_1.logApiUsage)({
            apiKeyId,
            userId,
            endpoint: '/v1/svg/generate',
            method: 'POST',
            statusCode,
            latencyMs: Date.now() - startTime,
            creditsUsed: 0,
        }).catch((err) => logger_1.logger.error({ err, apiKeyId, userId }, 'Failed to log API usage'));
        (0, rateLimitHeaders_1.setRateLimitHeaders)(req, res);
        res.status(statusCode).json({
            error: errorMessage,
            statusCode,
        });
    }
});
/**
 * GET /v1/svg/job/:id
 * Get generation job status and result
 */
router.get('/svg/job/:id', apiKeyAuth_1.apiKeyAuth, (0, rateLimiter_1.createPlanRateLimiter)(), (0, monthlyGenerationQuota_1.monthlyGenerationQuota)({ skipCheck: true }), async (req, res) => {
    var _a, _b;
    const startTime = Date.now();
    const userId = (0, getUserId_1.requireUserId)(req);
    const apiKeyId = req.apiKey.id;
    try {
        const { id } = req.params;
        const job = await prisma_1.default.generationJob.findFirst({
            where: {
                id,
                userId,
            },
            select: {
                id: true,
                status: true,
                prompt: true,
                style: true,
                model: true,
                errorCode: true,
                errorMessage: true,
                createdAt: true,
                finishedAt: true,
                creditsCharged: true,
                generation: {
                    select: {
                        svg: true,
                        s3Key: true,
                    },
                },
            },
        });
        if (!job) {
            await (0, usageTrackingService_1.logApiUsage)({
                apiKeyId,
                userId,
                endpoint: '/v1/svg/job/:id',
                method: 'GET',
                statusCode: 404,
                latencyMs: Date.now() - startTime,
            });
            return res.status(404).json({ error: 'Job not found' });
        }
        await (0, usageTrackingService_1.logApiUsage)({
            apiKeyId,
            userId,
            endpoint: '/v1/svg/job/:id',
            method: 'GET',
            statusCode: 200,
            latencyMs: Date.now() - startTime,
        });
        res.json({
            job: {
                id: job.id,
                status: job.status,
                prompt: job.prompt,
                style: job.style,
                model: job.model,
                svg: ((_a = job.generation) === null || _a === void 0 ? void 0 : _a.svg) || null,
                url: ((_b = job.generation) === null || _b === void 0 ? void 0 : _b.s3Key)
                    ? `${env_1.PUBLIC_ASSETS_BASE_URL}/${job.generation.s3Key}`
                    : null,
                errorCode: job.errorCode,
                errorMessage: job.errorMessage,
                createdAt: job.createdAt,
                finishedAt: job.finishedAt,
                creditsCharged: job.creditsCharged,
            },
        });
    }
    catch (error) {
        logger_1.logger.error({
            error,
            userId,
            apiKeyId,
            jobId: req.params.id,
        }, 'Failed to fetch job status');
        await (0, usageTrackingService_1.logApiUsage)({
            apiKeyId,
            userId,
            endpoint: '/v1/svg/job/:id',
            method: 'GET',
            statusCode: 500,
            latencyMs: Date.now() - startTime,
        });
        res.status(500).json({ error: 'Failed to retrieve job status' });
    }
});
exports.default = router;
