"use strict";
/**
 * Credit Refill Service
 * Handles automatic 30-day rolling credit refills for users
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processUserCreditRefill = processUserCreditRefill;
exports.initializeCreditRefill = initializeCreditRefill;
exports.updateCreditRefillOnPlanChange = updateCreditRefillOnPlanChange;
exports.batchProcessCreditRefills = batchProcessCreditRefills;
exports.getCreditRefillInfo = getCreditRefillInfo;
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = require("../lib/logger");
const planLimits_1 = require("../utils/planLimits");
/**
 * Check if a user needs a credit refill and process it
 * Should be called before each generation or on-demand
 *
 * @param userId User ID to check for refill
 * @returns Updated credit balance
 */
async function processUserCreditRefill(userId) {
    try {
        const user = await prisma_1.default.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                plan: true,
                credits: true,
                creditRefillAmount: true,
                lastCreditRefillAt: true,
                nextCreditRefillAt: true,
            },
        });
        if (!user) {
            throw new Error('User not found');
        }
        // Check if refill is due
        const now = new Date();
        const needsRefill = user.nextCreditRefillAt && user.nextCreditRefillAt <= now;
        if (!needsRefill) {
            return user.credits;
        }
        // Get plan limits
        const planLimits = (0, planLimits_1.getPlanLimits)(user.plan);
        const refillAmount = user.creditRefillAmount || planLimits.creditRefillAmount;
        // Calculate next refill date
        const nextRefillDate = new Date(now);
        nextRefillDate.setDate(nextRefillDate.getDate() + planLimits.creditRefillDays);
        // Process refill
        const updatedUser = await prisma_1.default.user.update({
            where: { id: userId },
            data: {
                credits: { increment: refillAmount },
                lastCreditRefillAt: now,
                nextCreditRefillAt: nextRefillDate,
            },
            select: { credits: true },
        });
        logger_1.logger.info({
            userId,
            plan: user.plan,
            refillAmount,
            newBalance: updatedUser.credits,
            nextRefill: nextRefillDate.toISOString(),
        }, 'Credit refill processed');
        return updatedUser.credits;
    }
    catch (error) {
        logger_1.logger.error({
            error,
            userId,
        }, 'Failed to process credit refill');
        // Re-throw to let caller handle
        throw error;
    }
}
/**
 * Initialize credit refill schedule for a user
 * Should be called when a user signs up or changes plans
 *
 * @param userId User ID to initialize
 */
async function initializeCreditRefill(userId) {
    try {
        const user = await prisma_1.default.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                plan: true,
                creditRefillAmount: true,
                lastCreditRefillAt: true,
                nextCreditRefillAt: true,
            },
        });
        if (!user) {
            throw new Error('User not found');
        }
        // Skip if already initialized
        if (user.lastCreditRefillAt && user.nextCreditRefillAt) {
            return;
        }
        const planLimits = (0, planLimits_1.getPlanLimits)(user.plan);
        const now = new Date();
        const nextRefill = new Date(now);
        nextRefill.setDate(nextRefill.getDate() + planLimits.creditRefillDays);
        await prisma_1.default.user.update({
            where: { id: userId },
            data: {
                creditRefillAmount: planLimits.creditRefillAmount,
                lastCreditRefillAt: now,
                nextCreditRefillAt: nextRefill,
            },
        });
        logger_1.logger.info({
            userId,
            plan: user.plan,
            refillAmount: planLimits.creditRefillAmount,
            nextRefill: nextRefill.toISOString(),
        }, 'Credit refill schedule initialized');
    }
    catch (error) {
        logger_1.logger.error({
            error,
            userId,
        }, 'Failed to initialize credit refill');
        throw error;
    }
}
/**
 * Update credit refill schedule when user changes plans
 *
 * @param userId User ID
 * @param newPlan New plan type
 */
async function updateCreditRefillOnPlanChange(userId, newPlan) {
    try {
        const planLimits = (0, planLimits_1.getPlanLimits)(newPlan);
        // Update refill amount and reset schedule
        const now = new Date();
        const nextRefill = new Date(now);
        nextRefill.setDate(nextRefill.getDate() + planLimits.creditRefillDays);
        await prisma_1.default.user.update({
            where: { id: userId },
            data: {
                plan: newPlan,
                creditRefillAmount: planLimits.creditRefillAmount,
                lastCreditRefillAt: now,
                nextCreditRefillAt: nextRefill,
                // Grant starting credits on upgrade
                credits: { increment: planLimits.startingCredits },
            },
        });
        logger_1.logger.info({
            userId,
            newPlan,
            refillAmount: planLimits.creditRefillAmount,
            startingCredits: planLimits.startingCredits,
        }, 'Credit refill updated on plan change');
    }
    catch (error) {
        logger_1.logger.error({
            error,
            userId,
            newPlan,
        }, 'Failed to update credit refill on plan change');
        throw error;
    }
}
/**
 * Batch process credit refills for all users
 * Designed to be called from Lambda via EventBridge (hourly)
 *
 * Checks all users where nextCreditRefillAt <= now and processes refills
 *
 * @returns Number of users processed
 */
async function batchProcessCreditRefills() {
    try {
        const now = new Date();
        // Find all users who need refills
        const usersNeedingRefill = await prisma_1.default.user.findMany({
            where: {
                nextCreditRefillAt: {
                    lte: now,
                },
            },
            select: { id: true, plan: true },
        });
        logger_1.logger.info({ count: usersNeedingRefill.length }, 'Starting batch credit refill');
        let successCount = 0;
        let errorCount = 0;
        for (const user of usersNeedingRefill) {
            try {
                await processUserCreditRefill(user.id);
                successCount++;
            }
            catch (error) {
                logger_1.logger.error({
                    error,
                    userId: user.id,
                    plan: user.plan,
                }, 'Failed to process credit refill in batch');
                errorCount++;
            }
        }
        logger_1.logger.info({
            total: usersNeedingRefill.length,
            success: successCount,
            errors: errorCount,
        }, 'Batch credit refill completed');
        return successCount;
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Batch credit refill failed');
        throw error;
    }
}
/**
 * Get credit refill info for a user
 * Useful for displaying to users when their next refill is
 */
async function getCreditRefillInfo(userId) {
    try {
        const user = await prisma_1.default.user.findUnique({
            where: { id: userId },
            select: {
                plan: true,
                creditRefillAmount: true,
                nextCreditRefillAt: true,
            },
        });
        if (!user) {
            return null;
        }
        const planLimits = (0, planLimits_1.getPlanLimits)(user.plan);
        const refillAmount = user.creditRefillAmount || planLimits.creditRefillAmount;
        if (!user.nextCreditRefillAt) {
            return {
                nextRefillAt: null,
                refillAmount,
                daysUntilRefill: null,
            };
        }
        const now = new Date();
        const daysUntilRefill = Math.max(0, Math.ceil((user.nextCreditRefillAt.getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24)));
        return {
            nextRefillAt: user.nextCreditRefillAt,
            refillAmount,
            daysUntilRefill,
        };
    }
    catch (error) {
        logger_1.logger.error({ error, userId }, 'Failed to get credit refill info');
        return null;
    }
}
