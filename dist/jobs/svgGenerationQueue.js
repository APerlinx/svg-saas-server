"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.svgGenerationQueue = exports.SVG_GENERATION_QUEUE_NAME = void 0;
exports.enqueueSvgGenerationJob = enqueueSvgGenerationJob;
const bullmq_1 = require("bullmq");
const bullmq_2 = require("../lib/bullmq");
const logger_1 = require("../lib/logger");
exports.SVG_GENERATION_QUEUE_NAME = 'svg-generation';
const defaultJobOptions = {
    attempts: 3,
    removeOnComplete: {
        age: 60 * 60,
        count: 1000,
    },
    removeOnFail: {
        age: 24 * 60 * 60,
    },
    backoff: {
        type: 'exponential',
        delay: 5000,
    },
};
const queueConnection = (0, bullmq_2.createBullMqConnection)('svg-generation-queue');
exports.svgGenerationQueue = new bullmq_1.Queue(exports.SVG_GENERATION_QUEUE_NAME, {
    connection: queueConnection,
    defaultJobOptions,
});
async function enqueueSvgGenerationJob(jobId, userId) {
    try {
        await exports.svgGenerationQueue.add('generate-svg', { jobId, userId }, {
            jobId,
        });
    }
    catch (error) {
        if (isJobIdAlreadyExistsError(error)) {
            logger_1.logger.debug({ jobId }, 'Generation job already enqueued');
            return;
        }
        throw error;
    }
}
function isJobIdAlreadyExistsError(error) {
    if (error instanceof Error) {
        const normalized = error.message.toLowerCase();
        return (error.name === 'JobIdAlreadyExistsError' ||
            (normalized.includes('job') && normalized.includes('already exists')));
    }
    return false;
}
