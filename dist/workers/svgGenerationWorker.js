"use strict";
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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const bullmq_1 = require("bullmq");
const prisma_1 = __importDefault(require("../lib/prisma"));
const bullmq_2 = require("../lib/bullmq");
const svgGenerationQueue_1 = require("../jobs/svgGenerationQueue");
const logger_1 = require("../lib/logger");
const aiService_1 = require("../services/aiService");
const sanitizeSvg_1 = require("../utils/sanitizeSvg");
const cache_1 = require("../lib/cache");
const client_1 = require("@prisma/client");
const redis_1 = require("../lib/redis");
const svgStyles_1 = require("../constants/svgStyles");
const s3_1 = require("../lib/s3");
const env_1 = require("../config/env");
const Sentry = __importStar(require("@sentry/node"));
const notificationService_1 = require("../services/notificationService");
const concurrency = Number((_a = process.env.SVG_WORKER_CONCURRENCY) !== null && _a !== void 0 ? _a : 2);
const INSUFFICIENT_CREDITS_MESSAGE = 'You do not have enough credits to generate an SVG. Please purchase more credits and try again.';
function mapErrorToCode(error) {
    if (!(error instanceof Error)) {
        return { code: 'UNKNOWN_ERROR', message: 'Unknown error' };
    }
    const message = error.message.slice(0, 500);
    const normalized = message.toLowerCase();
    if (message.includes('INSUFFICIENT_CREDITS')) {
        return { code: 'INSUFFICIENT_CREDITS', message };
    }
    if (normalized.includes('rate limit') || message.includes('429')) {
        return { code: 'OPENAI_RATE_LIMIT', message };
    }
    if ((normalized.includes('model') && normalized.includes('not found')) ||
        message.includes('404')) {
        return { code: 'OPENAI_MODEL_NOT_FOUND', message };
    }
    if (normalized.includes('permission') ||
        normalized.includes('forbidden') ||
        message.includes('401') ||
        message.includes('403')) {
        return { code: 'OPENAI_PERMISSION', message };
    }
    if (normalized.includes('redis') || message.includes('ECONNREFUSED')) {
        return { code: 'REDIS_DOWN', message };
    }
    if (normalized.includes('validation') || normalized.includes('invalid')) {
        return { code: 'VALIDATION_ERROR', message };
    }
    if (normalized.includes('prisma') || normalized.includes('database')) {
        return { code: 'DATABASE_ERROR', message };
    }
    return { code: 'GENERATION_FAILED', message };
}
const workerConnection = (0, bullmq_2.createBullMqConnection)('svg-generation-worker');
(async () => {
    await (0, redis_1.connectRedis)().catch((error) => {
        logger_1.logger.error({ error }, 'Worker failed to connect to Redis cache client');
        process.exit(1);
    });
    await workerConnection.ping().catch((error) => {
        logger_1.logger.error({ error }, 'Failed to connect to BullMQ Redis');
        process.exit(1);
    });
    const worker = new bullmq_1.Worker(svgGenerationQueue_1.SVG_GENERATION_QUEUE_NAME, async (job) => {
        var _a, _b;
        const { jobId } = job.data;
        if (!jobId) {
            throw new Error('Job is missing jobId');
        }
        try {
            await job.updateProgress(5);
            // The DB is the source of truth for job state. The worker is designed to be safe to retry:
            // we always re-read state and short-circuit if work already completed.
            const jobRecord = await prisma_1.default.generationJob.findUnique({
                where: { id: jobId },
                select: {
                    id: true,
                    userId: true,
                    prompt: true,
                    style: true,
                    model: true,
                    privacy: true,
                    creditsCharged: true,
                    status: true,
                    generationId: true,
                    startedAt: true,
                },
            });
            if (!jobRecord) {
                throw new Error('Job not found');
            }
            if (jobRecord.generationId ||
                jobRecord.status === client_1.GenerationJobStatus.SUCCEEDED) {
                // Idempotency guard: if the generation was already persisted, don't generate again.
                logger_1.logger.debug({ jobId, status: jobRecord.status }, 'Job already succeeded, skipping');
                if (jobRecord.generationId) {
                    await (0, notificationService_1.createJobSucceededNotification)({
                        userId: jobRecord.userId,
                        jobId,
                        generationId: jobRecord.generationId,
                        prompt: jobRecord.prompt,
                        style: jobRecord.style,
                        model: jobRecord.model,
                    });
                    await (0, notificationService_1.maybeCreateOutOfCreditsNotification)({
                        userId: jobRecord.userId,
                        jobId,
                    });
                }
                return;
            }
            // Claim the job for processing. Using a conditional update ensures only one worker can
            // transition QUEUED -> RUNNING even if multiple workers receive the same BullMQ job.
            const claimResult = await prisma_1.default.generationJob.updateMany({
                where: {
                    id: jobId,
                    status: client_1.GenerationJobStatus.QUEUED,
                },
                data: {
                    status: client_1.GenerationJobStatus.RUNNING,
                    startedAt: (_a = jobRecord.startedAt) !== null && _a !== void 0 ? _a : new Date(),
                    lastStartedAt: new Date(),
                    errorCode: null,
                    errorMessage: null,
                },
            });
            if (claimResult.count === 0) {
                logger_1.logger.warn({ jobId }, 'Job already being processed by another worker');
                return;
            }
            if (!jobRecord.creditsCharged) {
                // Defensive charging path: the API normally charges before enqueueing, but retries or
                // partial failures should still charge at most once. This transaction prevents
                // double-charging and keeps job/account state consistent.
                await job.updateProgress(10);
                const result = await prisma_1.default.$transaction(async (tx) => {
                    const debitResult = await tx.user.updateMany({
                        where: { id: jobRecord.userId, credits: { gt: 0 } },
                        data: { credits: { decrement: 1 } },
                    });
                    if (debitResult.count === 0) {
                        return { success: false };
                    }
                    await tx.generationJob.update({
                        where: { id: jobId },
                        data: { creditsCharged: true },
                    });
                    return { success: true };
                });
                if (!result.success) {
                    const now = new Date();
                    await prisma_1.default.generationJob.updateMany({
                        where: {
                            id: jobId,
                            status: client_1.GenerationJobStatus.RUNNING,
                            generationId: null,
                        },
                        data: {
                            status: client_1.GenerationJobStatus.FAILED,
                            finishedAt: now,
                            lastFailedAt: now,
                            errorCode: 'INSUFFICIENT_CREDITS',
                            errorMessage: INSUFFICIENT_CREDITS_MESSAGE,
                        },
                    });
                    await (0, notificationService_1.createJobFailedNotification)({
                        userId: jobRecord.userId,
                        jobId,
                    });
                    throw new bullmq_1.UnrecoverableError('INSUFFICIENT_CREDITS');
                }
            }
            await job.updateProgress(25);
            // NOTE:
            // On retries we currently re-generate the SVG instead of reusing a previous one.
            // This keeps the system simpler and avoids additional staging state.
            // If metrics show a high retry rate or significant extra LLM cost,
            // consider persisting the first successful SVG attempt and retrying only persistence.
            const { svg, metrics } = await (0, aiService_1.generateSvg)(jobRecord.prompt, (_b = jobRecord.style) !== null && _b !== void 0 ? _b : svgStyles_1.DEFAULT_STYLE, jobRecord.model);
            try {
                await prisma_1.default.generationJob.update({
                    where: { id: jobId },
                    data: {
                        aiModel: metrics.model,
                        aiPromptTokens: metrics.promptTokens,
                        aiCompletionTokens: metrics.completionTokens,
                        aiTotalTokens: metrics.totalTokens,
                        aiLatencyMs: metrics.latencyMs,
                        aiAttempts: metrics.attempts,
                    },
                });
            }
            catch (metricsError) {
                logger_1.logger.warn({ error: metricsError, jobId }, 'Failed to store AI metrics');
            }
            await job.updateProgress(75);
            const cleanSvg = (0, sanitizeSvg_1.sanitizeSvg)(svg);
            await job.updateProgress(85);
            const generationId = await prisma_1.default.$transaction(async (tx) => {
                // We currently persist the generation and mark the job SUCCEEDED in the same transaction.
                // This keeps the DB consistent (no succeeded job without a generationId). The tradeoff is
                // that S3 upload is included when enabled; see TODO for decoupling if this becomes noisy.
                // TODO: oversized transaction- job shouldn't fail if S3 upload fails / update s3 fields fails - refactor as needed
                const generation = await tx.svgGeneration.create({
                    data: {
                        userId: jobRecord.userId,
                        prompt: jobRecord.prompt,
                        svg: cleanSvg,
                        style: jobRecord.style,
                        creditsUsed: 1,
                        model: jobRecord.model,
                        privacy: jobRecord.privacy,
                    },
                });
                if (env_1.IS_S3_ENABLED) {
                    const s3Key = (0, s3_1.buildGenerationSvgKey)(generation.userId, jobRecord.id);
                    const sizeBytes = Buffer.byteLength(cleanSvg, 'utf8');
                    // Upload to S3
                    await (0, s3_1.uploadSvg)({
                        key: s3Key,
                        svg: cleanSvg,
                        cacheControl: 'public, max-age=31536000, immutable',
                    });
                    await tx.svgGeneration.update({
                        where: { id: generation.id },
                        data: { s3Key, s3SizeBytes: sizeBytes },
                    });
                }
                await tx.generationJob.update({
                    where: { id: jobId },
                    data: {
                        status: client_1.GenerationJobStatus.SUCCEEDED,
                        finishedAt: new Date(),
                        generationId: generation.id,
                    },
                });
                return generation.id;
            });
            await (0, notificationService_1.createJobSucceededNotification)({
                userId: jobRecord.userId,
                jobId,
                generationId,
                prompt: jobRecord.prompt,
                style: jobRecord.style,
                model: jobRecord.model,
            });
            await (0, notificationService_1.maybeCreateOutOfCreditsNotification)({
                userId: jobRecord.userId,
                jobId,
            });
            await job.updateProgress(100);
            if (!jobRecord.privacy) {
                try {
                    // Best-effort invalidation for the most common first-page gallery query.
                    // Other variants (filters/limit) rely on the short TTL.
                    await cache_1.cache.del(cache_1.cache.buildKey('public:v4:first', 'style', 'all', 'model', 'all', 'limit', 50));
                }
                catch (cacheError) {
                    logger_1.logger.warn({ error: cacheError, jobId }, 'Failed to invalidate cache, but job succeeded');
                }
            }
            logger_1.logger.info({ jobId }, 'SVG generation job completed');
        }
        catch (error) {
            const mapped = mapErrorToCode(error);
            logger_1.logger.error({
                error: mapped.message,
                errorCode: mapped.code,
                jobId: job.data.jobId,
            }, 'SVG generation job failed');
            if (env_1.IS_PRODUCTION && process.env.SENTRY_DSN) {
                Sentry.captureException(error, {
                    tags: { jobId: job.data.jobId, errorCode: mapped.code },
                });
            }
            throw error;
        }
    }, {
        connection: workerConnection,
        concurrency: Number.isNaN(concurrency) ? 2 : concurrency,
    });
    worker.on('completed', (job) => {
        if (!job)
            return;
        logger_1.logger.info({ jobId: job.id }, 'BullMQ worker marked job as completed');
    });
    worker.on('failed', async (job, err) => {
        var _a;
        if (!job)
            return;
        const attempts = (_a = job.opts.attempts) !== null && _a !== void 0 ? _a : 1;
        const isUnrecoverable = err instanceof bullmq_1.UnrecoverableError ||
            (err instanceof Error && err.name === 'UnrecoverableError');
        const isFinal = isUnrecoverable || job.attemptsMade >= attempts;
        const mapped = mapErrorToCode(err);
        const errorMessage = mapped.code === 'INSUFFICIENT_CREDITS'
            ? INSUFFICIENT_CREDITS_MESSAGE
            : mapped.message;
        // Persist failure details for UI/status tracking.
        if (!isFinal) {
            // Non-final failures re-queue the DB job so the next BullMQ attempt can claim it again.
            // (BullMQ will re-run the processor from the top on each attempt.)
            await prisma_1.default.generationJob.update({
                where: { id: job.data.jobId },
                data: {
                    status: client_1.GenerationJobStatus.QUEUED,
                    errorCode: mapped.code,
                    errorMessage,
                    attemptsMade: job.attemptsMade,
                    lastFailedAt: new Date(),
                },
            });
            logger_1.logger.warn({ jobId: job.id, error: err, attempt: job.attemptsMade }, 'Job failed, will retry');
            return;
        }
        if (isFinal) {
            const jobRecord = await prisma_1.default.generationJob.findUnique({
                where: { id: job.data.jobId },
                select: { userId: true },
            });
            if (jobRecord === null || jobRecord === void 0 ? void 0 : jobRecord.userId) {
                const refunded = await prisma_1.default.$transaction(async (tx) => {
                    // Refund is idempotent: we "claim" the refund with a conditional update so retries or
                    // double-delivery of failure events don't increment credits more than once.
                    const refundClaim = await tx.generationJob.updateMany({
                        where: {
                            id: job.data.jobId,
                            creditsCharged: true,
                            creditsRefunded: false,
                            generationId: null,
                        },
                        data: {
                            creditsRefunded: true,
                        },
                    });
                    // Only increment credits if we successfully claimed the refund
                    if (refundClaim.count > 0) {
                        await tx.user.update({
                            where: { id: jobRecord.userId },
                            data: { credits: { increment: 1 } },
                        });
                        return true;
                    }
                    return false;
                });
                if (refunded) {
                    logger_1.logger.info({ jobId: job.id }, 'Refunded credit after permanent failure');
                }
            }
            await prisma_1.default.generationJob.update({
                where: { id: job.data.jobId },
                data: {
                    status: client_1.GenerationJobStatus.FAILED,
                    finishedAt: new Date(),
                    errorCode: mapped.code,
                    errorMessage,
                    attemptsMade: job.attemptsMade,
                    lastFailedAt: new Date(),
                },
            });
            if (jobRecord === null || jobRecord === void 0 ? void 0 : jobRecord.userId) {
                await (0, notificationService_1.createJobFailedNotification)({
                    userId: jobRecord.userId,
                    jobId: job.data.jobId,
                });
            }
            logger_1.logger.error({ jobId: job.id, error: mapped.message, errorCode: mapped.code }, 'Job permanently failed after retries');
        }
    });
    logger_1.logger.info({ concurrency }, 'SVG generation worker started and ready');
})();
