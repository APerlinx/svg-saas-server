"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const prisma_1 = __importDefault(require("../lib/prisma"));
const svgStyles_1 = require("../constants/svgStyles");
const models_1 = require("../constants/models");
const getUserId_1 = require("../utils/getUserId");
const monthlyGenerationQuota_1 = require("../middleware/monthlyGenerationQuota");
const rateLimiter_1 = require("../middleware/rateLimiter");
const logger_1 = require("../lib/logger");
const notificationService_1 = require("../services/notificationService");
const cache_1 = require("../lib/cache");
const env_1 = require("../config/env");
const svgGenerationQueue_1 = require("../jobs/svgGenerationQueue");
const s3_1 = require("../lib/s3");
const svgGenerationService_1 = require("../services/svgGenerationService");
const router = (0, express_1.Router)();
router.post('/generate-svg', auth_1.authMiddleware, rateLimiter_1.svgGenerationLimiter, (0, monthlyGenerationQuota_1.monthlyGenerationQuota)(), async (req, res) => {
    var _a;
    try {
        const { prompt, style, model, privacy } = req.body;
        const userId = (0, getUserId_1.requireUserId)(req);
        const idempotencyKey = (_a = req.header('x-idempotency-key')) === null || _a === void 0 ? void 0 : _a.trim();
        // Create generation job (validation + idempotency check)
        const { job, duplicate } = await (0, svgGenerationService_1.createGenerationJob)({
            userId,
            prompt,
            style,
            model,
            privacy,
            idempotencyKey: idempotencyKey || '',
            requestId: req.requestId,
        });
        // If duplicate, return immediately (already charged)
        if (duplicate) {
            return res
                .status((0, svgGenerationService_1.getDuplicateStatus)(job))
                .location(`/api/svg/generation-jobs/${job.id}`)
                .json({
                job: (0, svgGenerationService_1.formatGenerationJobResponse)(job),
                duplicate: true,
            });
        }
        // Debit and job flag update must be atomic to prevent partial state (e.g. charge succeeded but
        // job not marked charged) and to ensure we never charge more than once for a single job.
        const charged = await prisma_1.default.$transaction(async (tx) => {
            const debitResult = await tx.user.updateMany({
                where: { id: userId, credits: { gt: 0 } },
                data: { credits: { decrement: 1 } },
            });
            if (debitResult.count === 0)
                return false;
            await tx.generationJob.update({
                where: { id: job.id },
                data: { creditsCharged: true },
            });
            return true;
        });
        if (!charged) {
            const failedJob = await prisma_1.default.generationJob.update({
                where: { id: job.id },
                data: {
                    status: client_1.GenerationJobStatus.FAILED,
                    finishedAt: new Date(),
                    lastFailedAt: new Date(),
                    errorCode: 'INSUFFICIENT_CREDITS',
                    errorMessage: 'You do not have enough credits to generate an SVG. Please purchase more credits and try again.',
                },
            });
            await (0, notificationService_1.createJobFailedNotification)({
                userId,
                jobId: job.id,
            });
            return res.status(402).json({
                error: failedJob.errorMessage,
            });
        }
        try {
            // After credits are charged, enqueue the async work. If enqueue fails we refund the credit
            // in an idempotent way (claim + refund) to avoid double refunds on retried error handling.
            await (0, svgGenerationService_1.enqueueGenerationJob)(job.id, userId);
            // Increment generation quota (non-blocking)
            await (0, monthlyGenerationQuota_1.incrementGenerationQuota)(userId);
        }
        catch (error) {
            logger_1.logger.error({ error, jobId: job.id, userId, requestId: req.requestId }, 'Failed to enqueue SVG generation job');
            await prisma_1.default.$transaction(async (tx) => {
                const refundClaim = await tx.generationJob.updateMany({
                    where: {
                        id: job.id,
                        status: client_1.GenerationJobStatus.QUEUED,
                        creditsCharged: true,
                        creditsRefunded: false,
                        generationId: null,
                    },
                    data: {
                        status: client_1.GenerationJobStatus.FAILED,
                        finishedAt: new Date(),
                        lastFailedAt: new Date(),
                        errorCode: 'ENQUEUE_FAILED',
                        errorMessage: 'Failed to enqueue job.',
                        creditsRefunded: true,
                    },
                });
                if (refundClaim.count > 0) {
                    await tx.user.update({
                        where: { id: userId },
                        data: { credits: { increment: 1 } },
                    });
                }
            });
            await (0, notificationService_1.createJobFailedNotification)({
                userId,
                jobId: job.id,
            });
            return res.status(503).json({
                error: 'Failed to start generation. Please retry.',
            });
        }
        let jobCounts;
        if (!env_1.IS_PRODUCTION) {
            jobCounts = await svgGenerationQueue_1.svgGenerationQueue.getJobCounts('waiting', 'delayed', 'active');
        }
        const responsePayload = {
            job: (0, svgGenerationService_1.formatGenerationJobResponse)(job),
            ...(jobCounts ? { queue: jobCounts } : {}),
        };
        res
            .status(202)
            .location(`/api/svg/generation-jobs/${job.id}`)
            .json(responsePayload);
    }
    catch (error) {
        if (error instanceof svgGenerationService_1.ValidationError) {
            return res.status(400).json({ error: error.message });
        }
        if (error instanceof svgGenerationService_1.ConflictError) {
            return res.status(409).json({ error: error.message });
        }
        if (error instanceof svgGenerationService_1.NotFoundError) {
            return res.status(404).json({ error: error.message });
        }
        logger_1.logger.error({ error, userId: (0, getUserId_1.getUserId)(req) }, 'SVG Generation error');
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/generation-jobs/:id', auth_1.authMiddleware, async (req, res) => {
    var _a;
    try {
        const { id } = req.params;
        const userId = (0, getUserId_1.requireUserId)(req);
        const generationJob = await prisma_1.default.generationJob.findFirst({
            where: {
                id,
                userId,
            },
            select: svgGenerationService_1.generationJobSelect,
        });
        if (!generationJob) {
            return res.status(404).json({ error: 'Generation job not found' });
        }
        const responsePayload = {
            job: (0, svgGenerationService_1.formatGenerationJobResponse)(generationJob),
        };
        const isTerminal = generationJob.status === 'SUCCEEDED' ||
            generationJob.status === 'FAILED';
        if (isTerminal) {
            const user = await prisma_1.default.user.findUnique({
                where: { id: generationJob.userId },
                select: { credits: true },
            });
            responsePayload.credits = (_a = user === null || user === void 0 ? void 0 : user.credits) !== null && _a !== void 0 ? _a : null;
        }
        res.json(responsePayload);
    }
    catch (error) {
        logger_1.logger.error({ error, jobId: req.params.id, userId: (0, getUserId_1.getUserId)(req) }, 'Error fetching generation job');
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/:id/download', auth_1.authMiddleware, rateLimiter_1.downloadLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = (0, getUserId_1.requireUserId)(req);
        const generation = await prisma_1.default.svgGeneration.findFirst({
            where: {
                id,
                userId,
            },
            select: { s3Key: true },
        });
        if (!generation) {
            return res.status(404).json({ error: 'Generation not found' });
        }
        if (!generation.s3Key) {
            return res
                .status(404)
                .json({ error: 'File not available. Please try generating again.' });
        }
        const downloadUrl = await (0, s3_1.getDownloadUrl)(generation.s3Key);
        res.set('Cache-Control', 'no-store');
        res.json({ downloadUrl });
    }
    catch (error) {
        logger_1.logger.error({ error, generationId: req.params.id, userId: (0, getUserId_1.getUserId)(req) }, 'Error generating download URL');
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/public', async (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(rawLimit, 1), 100)
        : 50;
    const nextCursor = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : undefined;
    const style = typeof req.query.style === 'string' ? req.query.style.trim() : undefined;
    const model = typeof req.query.model === 'string' ? req.query.model.trim() : undefined;
    const isFirstPage = !nextCursor;
    const cacheKey = cache_1.cache.buildKey('public:v4:first', 'style', style !== null && style !== void 0 ? style : 'all', 'model', model !== null && model !== void 0 ? model : 'all', 'limit', limit);
    const buildPublicSvgUrl = (s3Key) => {
        if (!s3Key)
            return null;
        if (!env_1.PUBLIC_ASSETS_BASE_URL)
            return null;
        return `${env_1.PUBLIC_ASSETS_BASE_URL}/${s3Key}`;
    };
    try {
        if (style && !svgStyles_1.VALID_SVG_STYLES.includes(style)) {
            return res.status(400).json({
                error: `Invalid style. Must be one of: ${svgStyles_1.VALID_SVG_STYLES.join(', ')}`,
            });
        }
        if (model && !models_1.VALID_MODELS.includes(model)) {
            return res.status(400).json({
                error: `Invalid model. Must be one of: ${models_1.VALID_MODELS.join(', ')}`,
            });
        }
        const where = {
            privacy: false,
            ...(style ? { style } : {}),
            ...(model ? { model } : {}),
        };
        const fetchPage = async (cursor) => {
            const publicGenerations = await prisma_1.default.svgGeneration.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: limit + 1,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                select: {
                    id: true,
                    prompt: true,
                    style: true,
                    model: true,
                    createdAt: true,
                    s3Key: true,
                },
            });
            const hasMore = publicGenerations.length > limit;
            const items = hasMore ? publicGenerations.slice(0, -1) : publicGenerations;
            const newNextCursor = hasMore ? items[items.length - 1].id : null;
            return {
                publicGenerations: items.map((generation) => ({
                    id: generation.id,
                    prompt: generation.prompt,
                    style: generation.style,
                    model: generation.model,
                    createdAt: generation.createdAt,
                    svgUrl: buildPublicSvgUrl(generation.s3Key),
                })),
                nextCursor: newNextCursor,
            };
        };
        if (isFirstPage) {
            const cached = await cache_1.cache.getOrSetJson(cacheKey, async () => fetchPage(undefined), { ttlSeconds: 60 });
            // Cache key versioning should prevent old shapes, but keep this defensive.
            if (cached &&
                typeof cached === 'object' &&
                'publicGenerations' in cached &&
                Array.isArray(cached.publicGenerations)) {
                const normalized = {
                    ...cached,
                    publicGenerations: cached.publicGenerations.map((generation) => {
                        const svgUrl = typeof (generation === null || generation === void 0 ? void 0 : generation.svgUrl) === 'string'
                            ? generation.svgUrl
                            : null;
                        return {
                            id: generation === null || generation === void 0 ? void 0 : generation.id,
                            prompt: generation === null || generation === void 0 ? void 0 : generation.prompt,
                            style: generation === null || generation === void 0 ? void 0 : generation.style,
                            model: generation === null || generation === void 0 ? void 0 : generation.model,
                            createdAt: generation === null || generation === void 0 ? void 0 : generation.createdAt,
                            svgUrl,
                        };
                    }),
                };
                return res.json(normalized);
            }
            return res.json(cached);
        }
        return res.json(await fetchPage(nextCursor));
    }
    catch (error) {
        if (nextCursor &&
            error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2025') {
            return res.status(400).json({
                error: 'Invalid cursor',
                errorCode: 'INVALID_CURSOR',
            });
        }
        logger_1.logger.error({ error }, 'Error fetching new public SVGs');
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/:id/source', auth_1.optionalAuthMiddleware, async (req, res) => {
    try {
        const currentUserId = (0, getUserId_1.getUserId)(req);
        const id = typeof req.params.id === 'string' ? req.params.id.trim() : undefined;
        if (!id) {
            return res.status(400).json({ error: 'Invalid SVG ID' });
        }
        const generation = await prisma_1.default.svgGeneration.findUnique({
            where: { id },
            select: {
                id: true,
                userId: true,
                privacy: true,
                s3Key: true,
                svg: true,
            },
        });
        if (!generation) {
            return res.status(404).json({ error: 'SVG not found' });
        }
        if (generation.privacy && generation.userId !== currentUserId) {
            return res.status(403).json({ error: 'Access denied to this SVG' });
        }
        let svg = null;
        if (generation.s3Key) {
            svg = await (0, s3_1.getSvgSourceFromS3)(generation.s3Key);
        }
        else if (generation.svg) {
            // Dev/legacy fallback when S3 storage is disabled.
            svg = generation.svg;
        }
        res.set('Cache-Control', 'no-store');
        return res.json({ id: generation.id, svg: svg !== null && svg !== void 0 ? svg : null });
    }
    catch (error) {
        logger_1.logger.error({ error, svgId: req.params.id, userId: (0, getUserId_1.getUserId)(req) }, 'Error fetching SVG source by ID');
        return res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
