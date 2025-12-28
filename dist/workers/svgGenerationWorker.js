"use strict";
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
/* DOC: concurrency controls how many jobs this worker processes in parallel.
   Defaults to 2 if SVG_WORKER_CONCURRENCY isn't set in .env.
   Trade-off: Higher concurrency = more throughput but higher memory/OpenAI rate limit pressure.
   On Render's free tier (512MB RAM), we keep it low to avoid OOM. */
const concurrency = Number((_a = process.env.SVG_WORKER_CONCURRENCY) !== null && _a !== void 0 ? _a : 2);
/* DOC: mapErrorToCode translates arbitrary errors (OpenAI errors, network failures, DB errors) into stable error codes.
   We store these codes in GenerationJob.errorCode so the frontend can display user-friendly messages.
   Engineering note: We normalize errors instead of exposing raw stack traces to avoid leaking internals. */
function mapErrorToCode(error) {
    /* DOC: Type guard: if error isn't an Error instance, we can't inspect .message, so return a fallback. */
    if (!(error instanceof Error)) {
        return { code: 'UNKNOWN_ERROR', message: 'Unknown error' };
    }
    /* DOC: Truncate message to 500 chars to avoid bloating the DB with massive stack traces. */
    const message = error.message.slice(0, 500);
    const normalized = message.toLowerCase();
    /* DOC: Check for our custom INSUFFICIENT_CREDITS sentinel (thrown during credit claim).
       This is exact match—not normalized—because we control this string. */
    if (message.includes('INSUFFICIENT_CREDITS')) {
        return { code: 'INSUFFICIENT_CREDITS', message };
    }
    /* DOC: OpenAI rate limit: detect HTTP 429 or "rate limit" substring in the error message.
       Clients should retry with exponential backoff (handled by BullMQ). */
    if (normalized.includes('rate limit') || message.includes('429')) {
        return { code: 'OPENAI_RATE_LIMIT', message };
    }
    /* DOC: Model not found: OpenAI returns 404 if the model name is invalid or deprecated (e.g., gpt-3.5-turbo-0301).
       This is permanent—no point retrying. */
    if ((normalized.includes('model') && normalized.includes('not found')) ||
        message.includes('404')) {
        return { code: 'OPENAI_MODEL_NOT_FOUND', message };
    }
    /* DOC: Permission errors: HTTP 401/403 or "permission"/"forbidden" text.
       Usually means bad API key or org quota exhausted—should alert ops. */
    if (normalized.includes('permission') ||
        normalized.includes('forbidden') ||
        message.includes('401') ||
        message.includes('403')) {
        return { code: 'OPENAI_PERMISSION', message };
    }
    /* DOC: Redis connection errors: if cache.set() fails or BullMQ can't reach Redis.
       We log but don't fail the job—cache is non-critical. */
    if (normalized.includes('redis') || message.includes('ECONNREFUSED')) {
        return { code: 'REDIS_DOWN', message };
    }
    /* DOC: Validation errors: bad input that shouldn't have passed route validation (defense in depth). */
    if (normalized.includes('validation') || normalized.includes('invalid')) {
        return { code: 'VALIDATION_ERROR', message };
    }
    /* DOC: Prisma/database errors: connection pool exhausted, constraint violations, etc. */
    if (normalized.includes('prisma') || normalized.includes('database')) {
        return { code: 'DATABASE_ERROR', message };
    }
    /* DOC: Fallback: unknown error type. Still log the message for debugging. */
    return { code: 'GENERATION_FAILED', message };
}
/* DOC: Create a dedicated Redis connection for the Worker side.
   This is separate from the Queue connection to avoid command blocking (BRPOPLPUSH vs LPUSH). */
const workerConnection = (0, bullmq_2.createBullMqConnection)('svg-generation-worker');
(async () => {
    /* DOC: Connect to the node-redis cache client before processing jobs.
       If cache.set() is called without this, it'll throw ENOTREADY.
       Trade-off: We fail-fast (exit 1) if Redis is unreachable—better than silently processing jobs without cache. */
    await (0, redis_1.connectRedis)().catch((error) => {
        logger_1.logger.error({ error }, 'Worker failed to connect to Redis cache client');
        process.exit(1);
    });
    /* DOC: Ping the BullMQ Redis connection to verify it's reachable.
       If this fails, the worker can't fetch jobs, so we exit rather than sit idle. */
    await workerConnection.ping().catch((error) => {
        logger_1.logger.error({ error }, 'Failed to connect to BullMQ Redis');
        process.exit(1);
    });
    /* DOC: Worker is BullMQ's job processor—it polls the queue and invokes our async function for each job.
       The generic type <SvgGenerationJobData> ensures job.data has the shape { jobId: string }. */
    const worker = new bullmq_1.Worker(
    /* DOC: Must match SVG_GENERATION_QUEUE_NAME so the worker knows which Redis keys to monitor. */
    svgGenerationQueue_1.SVG_GENERATION_QUEUE_NAME, 
    /* DOC: This async function is the "processor"—it runs once per job.
       If it throws, BullMQ marks the job as failed and may retry (based on attempts config).
       If it returns (or resolves), BullMQ marks the job as completed. */
    async (job) => {
        var _a, _b, _c;
        const { jobId } = job.data;
        /* DOC: Defensive check: if the queue somehow enqueued a malformed payload, fail early. */
        if (!jobId) {
            throw new Error('Job is missing jobId');
        }
        try {
            /* DOC: Fetch the GenerationJob row from Postgres.
               We only stored the ID in Redis, so we need to hydrate the full prompt/style/model here.
               Trade-off: Extra DB round-trip, but keeps Redis memory usage minimal. */
            const jobRecord = await prisma_1.default.generationJob.findUnique({
                where: { id: jobId },
                select: {
                    id: true,
                    userId: true,
                    prompt: true,
                    style: true,
                    model: true,
                    privacy: true,
                    creditsCharged: true, // Check if we already deducted credits
                    status: true,
                    generationId: true, // Check if we already created the SVG
                    startedAt: true,
                },
            });
            /* DOC: If the job row doesn't exist, something deleted it (admin cleanup? bug?).
               We throw to mark the BullMQ job as failed—don't want it retrying forever. */
            if (!jobRecord) {
                throw new Error('Job not found');
            }
            /* DOC: Idempotency check: if this job already succeeded (generationId is set), skip all work.
               This can happen if:
               1. The worker crashed after persisting the SVG but before BullMQ marked it completed
               2. BullMQ retried due to a transient error after we succeeded
               We log and return (no throw) so BullMQ marks it as completed. */
            if (jobRecord.generationId ||
                jobRecord.status === client_1.GenerationJobStatus.SUCCEEDED) {
                logger_1.logger.debug({ jobId, status: jobRecord.status }, 'Job already succeeded, skipping');
                return;
            }
            /* DOC: STEP 1: Atomically claim the job by transitioning QUEUED → RUNNING.
               We use updateMany (not update) with a WHERE status = QUEUED filter.
               If another worker already claimed it (concurrent retry), count will be 0 and we bail out. */
            const claimResult = await prisma_1.default.generationJob.updateMany({
                where: {
                    id: jobId,
                    status: client_1.GenerationJobStatus.QUEUED, // Only claim if still queued
                },
                data: {
                    status: client_1.GenerationJobStatus.RUNNING,
                    /* DOC: startedAt is set only on the first attempt (if null), so we preserve the original start time across retries. */
                    startedAt: (_a = jobRecord.startedAt) !== null && _a !== void 0 ? _a : new Date(),
                    /* DOC: lastStartedAt updates every attempt, giving us a "last heartbeat" timestamp. */
                    lastStartedAt: new Date(),
                    /* DOC: Clear error fields from previous attempts so the frontend doesn't see stale errors. */
                    errorCode: null,
                    errorMessage: null,
                },
            });
            /* DOC: If count === 0, another worker beat us to the claim—exit gracefully (no throw).
               BullMQ will mark this as completed because we didn't throw. */
            if (claimResult.count === 0) {
                logger_1.logger.warn({ jobId }, 'Job already being processed by another worker');
                return;
            }
            /* DOC: STEP 2: Charge credits if we haven't already.
               We defer charging until after claim to avoid charging users for jobs that never run (e.g., queue is paused).
               Trade-off: If the worker crashes before charging, the user gets a free retry. But this is rare and better than overcharging. */
            if (!jobRecord.creditsCharged) {
                /* DOC: Use a Prisma transaction to atomically debit the user and mark creditsCharged=true.
                   This prevents:
                   1. Double charging if two workers somehow both claim (rare but possible with network partitions)
                   2. Lost charges if the worker crashes between debit and marking charged */
                const result = await prisma_1.default.$transaction(async (tx) => {
                    /* DOC: updateMany (not update) with credits > 0 ensures we only debit if the user has credits.
                         If count === 0, the user is out of credits—we fail the job below. */
                    const debitResult = await tx.user.updateMany({
                        where: { id: jobRecord.userId, credits: { gt: 0 } },
                        data: { credits: { decrement: 1 } },
                    });
                    /* DOC: Early return (still in transaction) if debit failed. */
                    if (debitResult.count === 0) {
                        return { success: false };
                    }
                    /* DOC: Mark creditsCharged=true so we don't debit again on retry. */
                    await tx.generationJob.update({
                        where: { id: jobId },
                        data: { creditsCharged: true },
                    });
                    return { success: true };
                });
                /* DOC: If transaction returned success: false, mark the job as permanently failed and throw.
                   We throw INSUFFICIENT_CREDITS (our custom sentinel) so mapErrorToCode can identify it. */
                if (!result.success) {
                    await prisma_1.default.generationJob.update({
                        where: { id: jobId },
                        data: {
                            status: client_1.GenerationJobStatus.FAILED,
                            finishedAt: new Date(),
                            errorCode: 'INSUFFICIENT_CREDITS',
                            errorMessage: 'User does not have enough credits.',
                        },
                    });
                    throw new Error('INSUFFICIENT_CREDITS');
                }
            }
            /* DOC: STEP 3: Call the OpenAI API to generate the SVG.
               This is the slowest part (1-5 seconds) and the most likely to fail (rate limits, timeouts, etc.).
               If it throws, we catch it in the outer catch block and BullMQ will retry. */
            const svg = await (0, aiService_1.generateSvg)(jobRecord.prompt, (_b = jobRecord.style) !== null && _b !== void 0 ? _b : svgStyles_1.DEFAULT_STYLE, // Fallback to 'outline' if style is null
            jobRecord.model);
            /* DOC: STEP 4: Sanitize the SVG to strip <script>, event handlers, and other XSS vectors.
               Defense in depth—OpenAI shouldn't return malicious SVG, but we don't trust external APIs blindly. */
            const cleanSvg = (0, sanitizeSvg_1.sanitizeSvg)(svg);
            /* DOC: STEP 5: Persist the SVG and mark the job as succeeded, atomically.
               We use a transaction so if the SvgGeneration insert fails, the GenerationJob doesn't get marked succeeded. */
            await prisma_1.default.$transaction(async (tx) => {
                /* DOC: Create the SvgGeneration row with the sanitized SVG and job metadata. */
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
                /* DOC: Update GenerationJob to SUCCEEDED and link it to the SvgGeneration via generationId.
                       The frontend polls this status and fetches generation.svg once it's set. */
                await tx.generationJob.update({
                    where: { id: jobId },
                    data: {
                        status: client_1.GenerationJobStatus.SUCCEEDED,
                        finishedAt: new Date(),
                        generationId: generation.id,
                    },
                });
            });
            /* DOC: STEP 6: Invalidate the public cache if the SVG is public (privacy: false).
               We delete the first page of the public feed so users see the new SVG immediately.
               Trade-off: We only bust page 1—other pages will lag until their TTL expires (60s). */
            if (!jobRecord.privacy) {
                try {
                    await cache_1.cache.del(cache_1.cache.buildKey('public', 'page', 1, 'limit', 10));
                }
                catch (cacheError) {
                    /* DOC: If cache.del fails (Redis down), we log but don't fail the job—cache is non-critical. */
                    logger_1.logger.warn({ error: cacheError, jobId }, 'Failed to invalidate cache, but job succeeded');
                }
            }
            logger_1.logger.info({ jobId }, 'SVG generation job completed');
            /* DOC: If we reach here, the job succeeded—BullMQ will mark it as completed and stop retrying. */
        }
        catch (error) {
            /* DOC: If any step threw (OpenAI error, DB error, etc.), we land here.
               We map the error to a stable code and decide whether to retry or fail permanently. */
            const mapped = mapErrorToCode(error);
            /* DOC: Check if this is the final attempt. BullMQ's attempts includes the initial try, so 3 attempts = 1 initial + 2 retries. */
            const attempts = (_c = job.opts.attempts) !== null && _c !== void 0 ? _c : 1;
            const isFinal = job.attemptsMade + 1 >= attempts;
            /* DOC: On non-final failures, reset status to QUEUED so the next retry can claim it.
               Without this, status stays RUNNING and the retry would skip (claim fails). */
            if (!isFinal) {
                await prisma_1.default.generationJob.update({
                    where: { id: jobId },
                    data: {
                        status: client_1.GenerationJobStatus.QUEUED,
                        errorCode: mapped.code,
                        errorMessage: mapped.message,
                        /* DOC: Increment attemptsMade so the frontend can show "attempt 2 of 3". */
                        attemptsMade: job.attemptsMade + 1,
                        /* DOC: Record when this attempt failed for debugging/observability. */
                        lastFailedAt: new Date(),
                    },
                });
            }
            logger_1.logger.error({
                error: mapped.message,
                errorCode: mapped.code,
                jobId: job.data.jobId,
                isFinal,
            }, 'SVG generation job failed');
            /* DOC: Re-throw so BullMQ marks the job as failed and triggers the backoff delay. */
            throw error;
        }
    }, {
        /* DOC: Pass the worker connection so BullMQ can fetch jobs from Redis. */
        connection: workerConnection,
        /* DOC: concurrency: how many jobs to process in parallel.
             We parse the env var and fallback to 2 if it's not a number. */
        concurrency: Number.isNaN(concurrency) ? 2 : concurrency,
    });
    /* DOC: BullMQ emits lifecycle events—we wire them up for observability. */
    worker.on('completed', (job) => {
        /* DOC: 'completed' fires after the processor returns without throwing.
             job can be undefined if BullMQ's internal state is weird (rare), so we guard. */
        if (!job)
            return;
        logger_1.logger.info({ jobId: job.id }, 'BullMQ worker marked job as completed');
    });
    worker.on('failed', async (job, err) => {
        var _a;
        /* DOC: 'failed' fires after the processor throws and BullMQ decides whether to retry or give up. */
        if (!job)
            return;
        /* DOC: Check if BullMQ exhausted all retries—this is the final failure. */
        const attempts = (_a = job.opts.attempts) !== null && _a !== void 0 ? _a : 1;
        const isFinal = job.attemptsMade >= attempts;
        if (isFinal) {
            /* DOC: On permanent failure, refund the user's credit (but only if we charged them). */
            const mapped = mapErrorToCode(err);
            /* DOC: Fetch the userId so we can increment their credits. */
            const jobRecord = await prisma_1.default.generationJob.findUnique({
                where: { id: job.data.jobId },
                select: { userId: true },
            });
            if (jobRecord === null || jobRecord === void 0 ? void 0 : jobRecord.userId) {
                /* DOC: Use a transaction to atomically claim the refund and increment credits.
                   This prevents:
                   1. Double refunds if the worker crashes and BullMQ retries the 'failed' event (rare)
                   2. Lost refunds if the worker crashes between claim and increment */
                const refunded = await prisma_1.default.$transaction(async (tx) => {
                    /* DOC: updateMany with WHERE creditsCharged=true, creditsRefunded=false, generationId=null ensures we only refund once.
                           generationId=null prevents refunding a job that succeeded but BullMQ thinks failed (edge case). */
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
                    /* DOC: Only increment credits if we successfully claimed the refund (count > 0). */
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
            /* DOC: Mark the GenerationJob as permanently FAILED so the frontend stops polling. */
            await prisma_1.default.generationJob.update({
                where: { id: job.data.jobId },
                data: {
                    status: client_1.GenerationJobStatus.FAILED,
                    finishedAt: new Date(),
                    errorCode: mapped.code,
                    errorMessage: mapped.message,
                },
            });
            logger_1.logger.error({ jobId: job.id, error: mapped.message, errorCode: mapped.code }, 'Job permanently failed after retries');
        }
        else {
            /* DOC: Non-final failure—BullMQ will retry after the backoff delay.
                 We already reset status to QUEUED in the processor's catch block. */
            logger_1.logger.warn({ jobId: job.id, error: err, attempt: job.attemptsMade }, 'Job failed, will retry');
        }
    });
    logger_1.logger.info({ concurrency }, 'SVG generation worker started and ready');
})();
