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
const sanitizeInput_1 = require("../utils/sanitizeInput");
const computeRequestHash_1 = require("../utils/computeRequestHash");
const dailyLimit_1 = require("../middleware/dailyLimit");
const rateLimiter_1 = require("../middleware/rateLimiter");
const logger_1 = require("../lib/logger");
const cache_1 = require("../lib/cache");
const env_1 = require("../config/env");
const svgGenerationQueue_1 = require("../jobs/svgGenerationQueue");
const router = (0, express_1.Router)();
const generationJobSelect = client_1.Prisma.validator()({
    id: true,
    userId: true,
    prompt: true,
    style: true,
    model: true,
    privacy: true,
    status: true,
    createdAt: true,
    startedAt: true,
    finishedAt: true,
    errorCode: true,
    errorMessage: true,
    generationId: true,
    requestHash: true,
    generation: {
        select: {
            id: true,
            prompt: true,
            style: true,
            model: true,
            privacy: true,
            svg: true,
            createdAt: true,
        },
    },
});
function getDuplicateStatus(job) {
    return job.status === 'SUCCEEDED' || job.status === 'FAILED' ? 200 : 202;
}
function formatGenerationJobResponse(job) {
    return {
        id: job.id,
        status: job.status,
        prompt: job.prompt,
        style: job.style,
        model: job.model,
        privacy: job.privacy,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        generationId: job.generationId,
        generation: job.generation
            ? {
                id: job.generation.id,
                prompt: job.generation.prompt,
                style: job.generation.style,
                model: job.generation.model,
                privacy: job.generation.privacy,
                svg: job.generation.svg,
                createdAt: job.generation.createdAt,
            }
            : null,
    };
}
router.post('/generate-svg', auth_1.authMiddleware, rateLimiter_1.svgGenerationLimiter, (0, dailyLimit_1.dailyGenerationLimit)(50), async (req, res) => {
    var _a;
    try {
        const { prompt, style, model, privacy } = req.body;
        const userId = (0, getUserId_1.requireUserId)(req);
        // Validate and sanitize prompt
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        if (prompt.length < 10 || prompt.length > 500) {
            return res.status(400).json({
                error: 'Prompt length must be between 10 and 500 characters',
            });
        }
        const sanitizedPrompt = (0, sanitizeInput_1.sanitizeInput)(prompt);
        // Forbidden patterns
        const forbiddenPatterns = [
            /\<script/i,
            /javascript:/i,
            /onerror=/i,
            /onload=/i,
            /<iframe/i,
            /eval\(/i,
            /system.*prompt/i,
            /ignore.*instruction/i,
            /you are now/i,
        ];
        for (const pattern of forbiddenPatterns) {
            if (pattern.test(sanitizedPrompt)) {
                return res.status(400).json({
                    error: 'Prompt contains forbidden content. Please rephrase your request.',
                });
            }
        }
        // Validate style
        if (!style || !svgStyles_1.VALID_SVG_STYLES.includes(style)) {
            return res.status(400).json({
                error: `Invalid style. Must be one of: ${svgStyles_1.VALID_SVG_STYLES.join(', ')}`,
            });
        }
        // Validate model
        if (model && !models_1.VALID_MODELS.includes(model)) {
            return res.status(400).json({
                error: `Invalid model. Must be one of: ${models_1.VALID_MODELS.join(', ')}`,
            });
        }
        const selectedModel = model || models_1.DEFAULT_MODEL;
        const isPrivate = privacy !== null && privacy !== void 0 ? privacy : false;
        const rawIdempotencyKey = (_a = req.header('x-idempotency-key')) === null || _a === void 0 ? void 0 : _a.trim();
        if (rawIdempotencyKey && rawIdempotencyKey.length > 128) {
            return res
                .status(400)
                .json({ error: 'Idempotency key must be 128 characters or fewer' });
        }
        // Compute request hash for idempotency validation
        const requestHash = (0, computeRequestHash_1.computeRequestHash)({
            prompt: sanitizedPrompt,
            style,
            model: selectedModel,
            privacy: isPrivate,
        });
        if (rawIdempotencyKey) {
            const existingJob = await prisma_1.default.generationJob.findFirst({
                where: {
                    userId,
                    idempotencyKey: rawIdempotencyKey,
                },
                select: generationJobSelect,
            });
            if (existingJob) {
                // Check if request parameters match
                if (existingJob.requestHash === requestHash) {
                    // Same key + same params → return existing job
                    return res
                        .status(getDuplicateStatus(existingJob))
                        .location(`/api/svg/generation-jobs/${existingJob.id}`)
                        .json({
                        job: formatGenerationJobResponse(existingJob),
                        duplicate: true,
                    });
                }
                else {
                    // Same key + different params → reject with 409
                    return res.status(409).json({
                        error: 'Idempotency key already used with different request parameters',
                    });
                }
            }
        }
        /* DOC: At this point validation passed and we have a clean job to process.
           Now we persist a GenerationJob row in Postgres with status=QUEUED.
           The worker will claim this row later and do the actual OpenAI call. */
        let generationJob;
        try {
            /* DOC: prisma.generationJob.create atomically inserts the row.
               We use select: generationJobSelect to get back exactly the fields we need (including requestHash). */
            generationJob = await prisma_1.default.generationJob.create({
                data: {
                    userId,
                    prompt: sanitizedPrompt,
                    style,
                    model: selectedModel,
                    privacy: isPrivate,
                    idempotencyKey: rawIdempotencyKey !== null && rawIdempotencyKey !== void 0 ? rawIdempotencyKey : null,
                    requestHash,
                },
                select: generationJobSelect,
            });
        }
        catch (createError) {
            /* DOC: If two concurrent requests with the same idempotency key both pass the pre-check (line 169),
               they'll both try to insert. The second one hits the unique constraint (userId, idempotencyKey) and throws P2002.
               We catch it here and re-query for the existing job to return it as a duplicate. */
            // Handle unique constraint violation on (userId, idempotencyKey)
            const isUniqueConstraintViolation = rawIdempotencyKey &&
                createError instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                createError.code === 'P2002';
            if (isUniqueConstraintViolation) {
                /* DOC: Re-fetch the job that the other request created. */
                const conflictingJob = await prisma_1.default.generationJob.findFirst({
                    where: {
                        userId,
                        idempotencyKey: rawIdempotencyKey,
                    },
                    select: generationJobSelect,
                });
                if (conflictingJob) {
                    /* DOC: Compare requestHash to ensure the other request had the same params.
                       If hashes match, return the existing job (200/202 depending on status).
                       If hashes differ, reject with 409 to signal key misuse. */
                    if (conflictingJob.requestHash === requestHash) {
                        return res
                            .status(getDuplicateStatus(conflictingJob))
                            .location(`/api/svg/generation-jobs/${conflictingJob.id}`)
                            .json({
                            job: formatGenerationJobResponse(conflictingJob),
                            /* DOC: duplicate: true tells the frontend this is a cached response, not a new job. */
                            duplicate: true,
                        });
                    }
                    /* DOC: Hashes differ—client is reusing a key with different parameters. Reject with 409. */
                    return res.status(409).json({
                        error: 'Idempotency key already used with different request parameters',
                    });
                }
            }
            /* DOC: Not a unique constraint error, or we couldn't find the conflicting job—re-throw so we return 500. */
            throw createError;
        }
        /* DOC: enqueueSvgGenerationJob pushes the job ID into BullMQ's Redis queue.
           The worker (separate process) will pick it up and process it asynchronously.
           If this throws (Redis down), the catch block logs and returns 500, but the DB row stays QUEUED. */
        await (0, svgGenerationQueue_1.enqueueSvgGenerationJob)(generationJob.id);
        /* DOC: In non-production, we fetch queue stats (waiting, delayed, active counts) for debugging.
           We skip this in prod to avoid an extra Redis round-trip on every request (saves ~10-20ms). */
        let jobCounts;
        // In non-production environments, include queue stats for observability
        if (!env_1.IS_PRODUCTION) {
            jobCounts = await svgGenerationQueue_1.svgGenerationQueue.getJobCounts('waiting', 'delayed', 'active');
        }
        /* DOC: Build the response payload. We conditionally include queue stats if we fetched them. */
        const responsePayload = {
            /* DOC: job contains the GenerationJob metadata (id, status, prompt, etc.) but NOT the SVG yet—worker hasn't run.
               The frontend will poll GET /generation-jobs/:id until status becomes SUCCEEDED. */
            job: formatGenerationJobResponse(generationJob),
            /* DOC: Spread operator: if jobCounts is defined, add { queue: { waiting, delayed, active } }; else, omit the key. */
            ...(jobCounts ? { queue: jobCounts } : {}),
        };
        /* DOC: Return 202 Accepted—standard HTTP status for async operations.
           Location header tells the client where to poll for updates.
           The frontend will GET /api/svg/generation-jobs/{id} every few seconds until job.status is SUCCEEDED or FAILED. */
        res
            .status(202)
            .location(`/api/svg/generation-jobs/${generationJob.id}`)
            .json(responsePayload);
    }
    catch (error) {
        logger_1.logger.error({ error, userId: (0, getUserId_1.getUserId)(req) }, 'SVG Generation error');
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/generation-jobs/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = (0, getUserId_1.requireUserId)(req);
        const generationJob = await prisma_1.default.generationJob.findFirst({
            where: {
                id,
                userId,
            },
            select: generationJobSelect,
        });
        if (!generationJob) {
            return res.status(404).json({ error: 'Generation job not found' });
        }
        res.json({ job: formatGenerationJobResponse(generationJob) });
    }
    catch (error) {
        logger_1.logger.error({ error, jobId: req.params.id, userId: (0, getUserId_1.getUserId)(req) }, 'Error fetching generation job');
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/history', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = (0, getUserId_1.requireUserId)(req);
        // Pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        // Get total count for pagination
        const totalCount = await prisma_1.default.svgGeneration.count({ where: { userId } });
        const generations = await prisma_1.default.svgGeneration.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            skip: skip,
            take: limit,
            select: {
                id: true,
                prompt: true,
                style: true,
                model: true,
                privacy: true,
                creditsUsed: true,
                createdAt: true,
            },
        });
        const totalPages = Math.ceil(totalCount / limit);
        const hasMore = page < totalPages;
        res.json({
            generations,
            pagination: {
                currentPage: page,
                totalPages,
                totalCount,
                limit,
                hasMore,
            },
        });
    }
    catch (error) {
        logger_1.logger.error({ error, userId: (0, getUserId_1.getUserId)(req) }, 'Error fetching SVG history');
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/public', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const cacheKey = cache_1.cache.buildKey('public', 'page', page, 'limit', limit);
        // Try to get from cache
        const { publicGenerations, totalCount, totalPages, hasMore } = await cache_1.cache.getOrSetJson(cacheKey, async () => {
            const totalCount = await prisma_1.default.svgGeneration.count({
                where: { privacy: false },
            });
            const totalPages = Math.ceil(totalCount / limit) || 0;
            const hasMore = page < totalPages;
            const publicGenerations = await prisma_1.default.svgGeneration.findMany({
                where: { privacy: false },
                orderBy: { createdAt: 'desc' },
                skip: skip,
                take: limit,
                select: {
                    id: true,
                    prompt: true,
                    style: true,
                    model: true,
                    privacy: true,
                    creditsUsed: true,
                    createdAt: true,
                },
            });
            return {
                publicGenerations,
                totalCount,
                totalPages,
                hasMore,
                page,
                limit,
            };
        }, { ttlSeconds: 60 });
        res.json({
            publicGenerations,
            pagination: { currentPage: page, totalPages, totalCount, limit, hasMore },
        });
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Error fetching public SVGs');
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/:id', auth_1.optionalAuthMiddleware, async (req, res) => {
    try {
        const currentUserId = (0, getUserId_1.getUserId)(req);
        const { id } = req.params;
        if (!id || id.trim() === '') {
            return res.status(400).json({ error: 'Invalid SVG ID' });
        }
        // Fetch the SVG first
        const svgGeneration = await prisma_1.default.svgGeneration.findUnique({
            where: { id },
        });
        // Check if exists
        if (!svgGeneration) {
            return res.status(404).json({ error: 'SVG not found' });
        }
        // Authorization check
        const isPublic = svgGeneration.privacy === false;
        const isOwner = currentUserId === svgGeneration.userId;
        if (!isPublic && !isOwner) {
            return res.status(404).json({ error: 'SVG not found' });
        }
        res.json({ svgGeneration });
    }
    catch (error) {
        logger_1.logger.error({ error, svgId: req.params.id }, 'Error fetching SVG by ID');
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
