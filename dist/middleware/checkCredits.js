"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkCreditsMiddleware = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const client_1 = require("@prisma/client");
const getUserId_1 = require("../utils/getUserId");
const logger_1 = require("../lib/logger");
// Middleware to check if user has enough credits
const checkCreditsMiddleware = async (req, res, next) => {
    try {
        const userId = (0, getUserId_1.requireUserId)(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const user = await prisma_1.default.user.findUnique({
            where: { id: userId },
            select: { id: true, credits: true, plan: true },
        });
        if (!user || user.credits <= 0) {
            return res.status(403).json({ error: 'Insufficient credits' });
        }
        const pendingJobs = await prisma_1.default.generationJob.count({
            where: {
                userId,
                status: {
                    in: [client_1.GenerationJobStatus.QUEUED, client_1.GenerationJobStatus.RUNNING],
                },
            },
        });
        if (user.credits - pendingJobs <= 0) {
            return res.status(403).json({
                error: 'You have reached the concurrent generation limit for your credits',
            });
        }
        // Attach user info to request for downstream handlers
        req.user = {
            userId: user.id,
        };
        next();
    }
    catch (error) {
        logger_1.logger.error({ error, userId: (0, getUserId_1.getUserId)(req) }, 'Credits check error');
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.checkCreditsMiddleware = checkCreditsMiddleware;
