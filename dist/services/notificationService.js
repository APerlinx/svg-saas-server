"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJobSucceededNotification = createJobSucceededNotification;
exports.createJobFailedNotification = createJobFailedNotification;
exports.maybeCreateOutOfCreditsNotification = maybeCreateOutOfCreditsNotification;
exports.createWelcomeNotification = createWelcomeNotification;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = require("../lib/logger");
function isUniqueConstraintViolation(error) {
    return (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002');
}
async function createNotificationOnce(args) {
    var _a, _b, _c;
    try {
        return await prisma_1.default.notification.create({
            data: {
                userId: args.userId,
                type: args.type,
                title: (_a = args.title) !== null && _a !== void 0 ? _a : null,
                message: args.message,
                jobId: (_b = args.jobId) !== null && _b !== void 0 ? _b : null,
                data: (_c = args.data) !== null && _c !== void 0 ? _c : undefined,
            },
        });
    }
    catch (error) {
        if (isUniqueConstraintViolation(error))
            return null;
        logger_1.logger.warn({ error, userId: args.userId, type: args.type, jobId: args.jobId }, 'Failed to create notification');
        return null;
    }
}
async function createJobSucceededNotification(args) {
    var _a, _b, _c, _d;
    return createNotificationOnce({
        userId: args.userId,
        jobId: args.jobId,
        type: client_1.NotificationType.JOB_SUCCEEDED,
        title: 'SVG ready',
        message: 'Your SVG generation finished successfully.',
        data: {
            generationId: (_a = args.generationId) !== null && _a !== void 0 ? _a : null,
            prompt: (_b = args.prompt) !== null && _b !== void 0 ? _b : null,
            style: (_c = args.style) !== null && _c !== void 0 ? _c : null,
            model: (_d = args.model) !== null && _d !== void 0 ? _d : null,
        },
    });
}
async function createJobFailedNotification(args) {
    return createNotificationOnce({
        userId: args.userId,
        jobId: args.jobId,
        type: client_1.NotificationType.JOB_FAILED,
        title: 'SVG generation failed',
        message: "Your SVG generation failed. If credits were charged, they should be refunded automatically. If you don't see a refund, please contact support.",
    });
}
async function maybeCreateOutOfCreditsNotification(args) {
    try {
        const user = await prisma_1.default.user.findUnique({
            where: { id: args.userId },
            select: { credits: true },
        });
        if (!user)
            return null;
        if (user.credits !== 0)
            return null;
        return await createNotificationOnce({
            userId: args.userId,
            jobId: args.jobId,
            type: client_1.NotificationType.LOW_CREDITS,
            title: 'Out of credits',
            message: 'We noticed you are out of credits. Just a reminder: you can buy more credits anytime.',
            data: { credits: 0 },
        });
    }
    catch (error) {
        logger_1.logger.warn({ error, userId: args.userId }, 'Failed out-of-credits notification');
        return null;
    }
}
async function createWelcomeNotification(args) {
    var _a;
    const name = (_a = args.name) === null || _a === void 0 ? void 0 : _a.trim();
    const greeting = name ? `Welcome, ${name}!` : 'Welcome!';
    return createNotificationOnce({
        userId: args.userId,
        type: client_1.NotificationType.SYSTEM_ANNOUNCEMENT,
        title: 'Welcome',
        message: `${greeting} Your account is ready. Generate your first SVG whenever you like.`,
        data: { kind: 'welcome' },
    });
}
