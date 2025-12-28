"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.svgGenerationQueue = exports.SVG_GENERATION_QUEUE_NAME = void 0;
exports.enqueueSvgGenerationJob = enqueueSvgGenerationJob;
const bullmq_1 = require("bullmq");
const bullmq_2 = require("../lib/bullmq");
const logger_1 = require("../lib/logger");
/* DOC: SVG_GENERATION_QUEUE_NAME is the Redis key namespace where BullMQ stores all job metadata.
   Under the hood, BullMQ creates keys like "bull:svg-generation:waiting", "bull:svg-generation:active", etc.
   This name must match between the Queue (where we enqueue) and the Worker (where we process). */
exports.SVG_GENERATION_QUEUE_NAME = 'svg-generation';
/* DOC: defaultJobOptions defines retry, retention, and backoff behavior for every job we add.
   These apply unless overridden per-job in the .add() call. */
const defaultJobOptions = {
    /* DOC: attempts: 3 means BullMQ will retry a failed job up to 3 times total (1 initial + 2 retries).
       After that, the job moves to the "failed" set and stops retrying.
       Trade-off: 3 strikes a balance between transient errors (network blips) and permanent failures (bad prompts). */
    attempts: 3,
    removeOnComplete: {
        /* DOC: age: 60 * 60 (in seconds) tells BullMQ to auto-delete completed jobs older than 1 hour.
           This keeps Redis memory bounded—we persist the result in Postgres, so we don't need the BullMQ metadata long-term. */
        age: 60 * 60, // keep successful jobs for an hour
        /* DOC: count: 1000 caps the number of completed jobs we keep in Redis at any time (FIFO deletion).
           Even if they're newer than 1 hour, once we hit 1000, the oldest completed jobs get purged.
           This prevents memory bloat during high traffic. */
        count: 1000,
    },
    removeOnFail: {
        /* DOC: age: 24 * 60 * 60 means we keep failed jobs for 24 hours before deleting them.
           We retain them longer than successes so we can debug failures (inspect error messages, retry counts, etc.). */
        age: 24 * 60 * 60, // keep failed jobs for a day
    },
    backoff: {
        /* DOC: type: 'exponential' makes BullMQ wait progressively longer between retries: 5s, then ~10s, then ~20s.
           This gives transient issues (rate limits, temporary network failures) time to resolve without hammering the system. */
        type: 'exponential',
        /* DOC: delay: 5_000 is the base delay in milliseconds (5 seconds).
           For attempt N, BullMQ waits roughly delay * 2^(N-1). So retry 1 waits 5s, retry 2 waits ~10s, etc. */
        delay: 5000,
    },
};
/* DOC: We create a dedicated Redis connection for the Queue side.
   This connection is used by the Express server to enqueue jobs (LPUSH commands).
   It's separate from the Worker connection to avoid blocking command interference. */
const queueConnection = (0, bullmq_2.createBullMqConnection)('svg-generation-queue');
/* DOC: svgGenerationQueue is our BullMQ Queue instance—it's the API we use in route handlers to add jobs.
   The generic type <{ jobId: string }> defines the shape of the job payload:
   we only store the GenerationJob.id here, not the full prompt/style/model (those live in Postgres). */
exports.svgGenerationQueue = new bullmq_1.Queue(exports.SVG_GENERATION_QUEUE_NAME, {
    /* DOC: connection: pass our dedicated ioredis client so BullMQ can talk to Redis. */
    connection: queueConnection,
    /* DOC: defaultJobOptions: apply the retry/retention config we defined above to all jobs. */
    defaultJobOptions,
});
/* DOC: enqueueSvgGenerationJob is the main entry point for adding a new generation job to the queue.
   We call this from svg.routes.ts after creating the GenerationJob row in Postgres. */
async function enqueueSvgGenerationJob(jobId) {
    try {
        /* DOC: svgGenerationQueue.add(...) pushes the job into Redis and returns immediately (non-blocking).
           The worker (running in a separate process) will pick it up asynchronously. */
        await exports.svgGenerationQueue.add(
        /* DOC: 'generate-svg' is the job name—used for logging and metrics but doesn't affect processing.
           All jobs in this queue use the same processor function in the worker. */
        'generate-svg', 
        /* DOC: { jobId } is the job payload—the only data we store in Redis.
           We keep it minimal to reduce memory usage; the worker will fetch full details from Postgres. */
        { jobId }, {
            /* DOC: jobId (as an option, not payload) tells BullMQ to use this as the unique key.
               This makes .add() idempotent: if a job with this ID already exists, BullMQ throws an error.
               Trade-off: we catch that error below to handle concurrent enqueues gracefully. */
            jobId,
        });
    }
    catch (error) {
        /* DOC: If BullMQ throws "job ID already exists", we treat it as success (no-op).
           This can happen if:
           1. A client retries the POST with the same idempotency key (we already created the job)
           2. Two requests race through the DB create and both try to enqueue
           Without this catch, we'd return 500 to the client even though the job is queued. */
        if (isJobIdAlreadyExistsError(error)) {
            logger_1.logger.debug({ jobId }, 'Generation job already enqueued');
            /* DOC: Early return—don't re-throw. The client's request still succeeds. */
            return;
        }
        /* DOC: Any other error (Redis down, invalid payload, etc.) bubbles up to the route handler's catch block. */
        throw error;
    }
}
/* DOC: isJobIdAlreadyExistsError is a type-safe helper to detect BullMQ's duplicate job error.
   BullMQ doesn't export a specific error class, so we pattern-match the error name and message. */
function isJobIdAlreadyExistsError(error) {
    if (error instanceof Error) {
        const normalized = error.message.toLowerCase();
        /* DOC: Check both the error.name (some BullMQ versions) and the message text (fallback).
           The "job" + "already exists" substring match is a defensive heuristic. */
        return (error.name === 'JobIdAlreadyExistsError' ||
            (normalized.includes('job') && normalized.includes('already exists')));
    }
    /* DOC: If error isn't even an Error instance, it's not a duplicate—return false and let it throw. */
    return false;
}
