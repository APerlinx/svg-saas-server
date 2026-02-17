"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startGenerationJobRealtimeEvents = startGenerationJobRealtimeEvents;
const bullmq_1 = require("bullmq");
const prisma_1 = __importDefault(require("../lib/prisma"));
const bullmq_2 = require("../lib/bullmq");
const logger_1 = require("../lib/logger");
const svgGenerationQueue_1 = require("../jobs/svgGenerationQueue");
const client_1 = require("@prisma/client");
async function startGenerationJobRealtimeEvents(io) {
    const connection = (0, bullmq_2.createBullMqConnection)('svg-generation-queue-events');
    const queueEvents = new bullmq_1.QueueEvents(svgGenerationQueue_1.SVG_GENERATION_QUEUE_NAME, {
        connection,
    });
    await queueEvents.waitUntilReady();
    const userIdCache = new Map();
    async function resolveUserId(jobId) {
        var _a;
        const cached = userIdCache.get(jobId);
        if (cached)
            return cached;
        try {
            const job = await svgGenerationQueue_1.svgGenerationQueue.getJob(jobId);
            const userId = (_a = job === null || job === void 0 ? void 0 : job.data) === null || _a === void 0 ? void 0 : _a.userId;
            if (userId) {
                userIdCache.set(jobId, userId);
                return userId;
            }
        }
        catch (error) {
            logger_1.logger.debug({ error, jobId }, 'Failed to resolve userId from BullMQ job');
        }
        const record = await prisma_1.default.generationJob.findUnique({
            where: { id: jobId },
            select: { userId: true },
        });
        if (record === null || record === void 0 ? void 0 : record.userId) {
            userIdCache.set(jobId, record.userId);
            return record.userId;
        }
        return null;
    }
    function emitToUser(userId, payload) {
        io.to(`user:${userId}`).emit('generation-job:update', payload);
    }
    queueEvents.on('active', async ({ jobId }) => {
        const userId = await resolveUserId(jobId);
        if (!userId)
            return;
        emitToUser(userId, { jobId, status: client_1.GenerationJobStatus.RUNNING });
    });
    queueEvents.on('progress', async ({ jobId, data }) => {
        const userId = await resolveUserId(jobId);
        if (!userId)
            return;
        const progress = typeof data === 'number' ? data : undefined;
        emitToUser(userId, {
            jobId,
            status: client_1.GenerationJobStatus.RUNNING,
            progress,
        });
    });
    queueEvents.on('completed', async ({ jobId }) => {
        var _a, _b, _c, _d;
        const userId = await resolveUserId(jobId);
        if (!userId)
            return;
        const job = await prisma_1.default.generationJob.findUnique({
            where: { id: jobId },
            select: {
                status: true,
                generationId: true,
                errorCode: true,
                errorMessage: true,
            },
        });
        emitToUser(userId, {
            jobId,
            status: (_a = job === null || job === void 0 ? void 0 : job.status) !== null && _a !== void 0 ? _a : client_1.GenerationJobStatus.SUCCEEDED,
            generationId: (_b = job === null || job === void 0 ? void 0 : job.generationId) !== null && _b !== void 0 ? _b : null,
            errorCode: (_c = job === null || job === void 0 ? void 0 : job.errorCode) !== null && _c !== void 0 ? _c : null,
            errorMessage: (_d = job === null || job === void 0 ? void 0 : job.errorMessage) !== null && _d !== void 0 ? _d : null,
            progress: 100,
        });
    });
    queueEvents.on('failed', async ({ jobId, failedReason }) => {
        var _a, _b, _c, _d, _e;
        const userId = await resolveUserId(jobId);
        if (!userId)
            return;
        const job = await prisma_1.default.generationJob.findUnique({
            where: { id: jobId },
            select: {
                status: true,
                generationId: true,
                errorCode: true,
                errorMessage: true,
            },
        });
        emitToUser(userId, {
            jobId,
            status: (_a = job === null || job === void 0 ? void 0 : job.status) !== null && _a !== void 0 ? _a : client_1.GenerationJobStatus.FAILED,
            generationId: (_b = job === null || job === void 0 ? void 0 : job.generationId) !== null && _b !== void 0 ? _b : null,
            errorCode: (_c = job === null || job === void 0 ? void 0 : job.errorCode) !== null && _c !== void 0 ? _c : null,
            errorMessage: (_e = (_d = job === null || job === void 0 ? void 0 : job.errorMessage) !== null && _d !== void 0 ? _d : failedReason) !== null && _e !== void 0 ? _e : null,
        });
    });
    queueEvents.on('error', (error) => {
        logger_1.logger.error({ error }, 'BullMQ QueueEvents error (realtime)');
    });
    logger_1.logger.info('Generation job realtime events started');
    return queueEvents;
}
