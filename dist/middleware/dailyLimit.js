"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyGenerationLimit = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const getUserId_1 = require("../utils/getUserId");
const env_1 = require("../config/env");
const logger_1 = require("../lib/logger");
/**
 * Middleware to enforce daily generation limit per user
 */
const dailyGenerationLimit = (maxGenerations = 50) => {
    if (env_1.IS_TEST) {
        return (req, res, next) => next();
    }
    return async (req, res, next) => {
        try {
            const userId = (0, getUserId_1.requireUserId)(req);
            // Get start of today (midnight)
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            // Count today's generations
            const todayGenerations = await prisma_1.default.svgGeneration.count({
                where: {
                    userId,
                    createdAt: { gte: today },
                },
            });
            // Check if limit reached
            if (todayGenerations >= maxGenerations) {
                return res.status(429).json({
                    error: 'Daily generation limit reached. Try again tomorrow.',
                    limit: maxGenerations,
                    used: todayGenerations,
                });
            }
            // Add info to request for logging/display
            req.dailyGenerationCount = todayGenerations;
            next();
        }
        catch (error) {
            logger_1.logger.error({ error, userId: (0, getUserId_1.getUserId)(req) }, 'Daily limit check error');
            next();
        }
    };
};
exports.dailyGenerationLimit = dailyGenerationLimit;
