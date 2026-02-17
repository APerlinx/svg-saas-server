"use strict";
/**
 * Plan limits and features configuration
 * Single source of truth for all plan-related limits
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_DESCRIPTIONS = exports.PLAN_NAMES = exports.PLAN_PRICES = exports.PLAN_LIMITS = void 0;
exports.getPlanLimits = getPlanLimits;
exports.hasFeature = hasFeature;
exports.canCreateApiKey = canCreateApiKey;
exports.getUpgradeRecommendation = getUpgradeRecommendation;
const logger_1 = require("../lib/logger");
exports.PLAN_LIMITS = {
    FREE: {
        // Credits
        startingCredits: 100,
        creditRefillAmount: 50,
        creditRefillDays: 30,
        // Unified generations
        generationsPerMonth: 100,
        // API Access
        apiAccess: true,
        maxApiKeys: 1,
        // Rate limits
        rateLimits: {
            perMinute: 5,
            perHour: 20,
            perDay: 100,
        },
        // Support
        supportLevel: 'community',
    },
    SUPPORTER: {
        // Credits
        startingCredits: 1000,
        creditRefillAmount: 500,
        creditRefillDays: 30,
        // Unified generations
        generationsPerMonth: 1000,
        // API Access
        apiAccess: true,
        maxApiKeys: 5,
        // Rate limits
        rateLimits: {
            perMinute: 15,
            perHour: 60,
            perDay: 500,
        },
        // Support
        supportLevel: 'email',
        supportChannel: 'email',
    },
};
/**
 * Get plan limits for a specific plan
 */
function getPlanLimits(plan) {
    if (plan in exports.PLAN_LIMITS) {
        return exports.PLAN_LIMITS[plan];
    }
    // Default to FREE if unknown plan
    logger_1.logger.warn({ plan }, 'Unknown plan type, defaulting to FREE');
    return exports.PLAN_LIMITS.FREE;
}
/**
 * Check if a plan has a specific feature
 */
function hasFeature(plan, feature) {
    const limits = getPlanLimits(plan);
    const value = limits[feature];
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value > 0;
    }
    return !!value;
}
/**
 * Check if user can create more API keys
 */
function canCreateApiKey(plan, currentKeyCount) {
    const limits = getPlanLimits(plan);
    if (!limits.apiAccess) {
        return false;
    }
    return currentKeyCount < limits.maxApiKeys;
}
/**
 * Get upgrade recommendation based on current usage
 */
function getUpgradeRecommendation(currentPlan, usage) {
    // Already on SUPPORTER (highest tier)
    if (currentPlan === 'SUPPORTER') {
        return { shouldUpgrade: false };
    }
    const currentLimits = getPlanLimits(currentPlan);
    // Check if user is hitting generation limits
    if (usage.generationsUsed &&
        usage.generationsUsed >= currentLimits.generationsPerMonth * 0.8) {
        return {
            shouldUpgrade: true,
            recommendedPlan: 'SUPPORTER',
            reason: `You're using ${usage.generationsUsed} of ${currentLimits.generationsPerMonth} generations`,
        };
    }
    // Check if user needs more credits
    if (usage.creditsUsed &&
        usage.creditsUsed >= currentLimits.startingCredits * 0.8) {
        return {
            shouldUpgrade: true,
            recommendedPlan: 'SUPPORTER',
            reason: 'Consider becoming a supporter for more credits and higher rate limits',
        };
    }
    return { shouldUpgrade: false };
}
/**
 * Get monthly price for each plan (in dollars)
 */
exports.PLAN_PRICES = {
    FREE: 0,
    SUPPORTER: 5,
};
/**
 * Plan display names for UI
 */
exports.PLAN_NAMES = {
    FREE: 'Free',
    SUPPORTER: 'Supporter',
};
/**
 * Plan descriptions for marketing
 */
exports.PLAN_DESCRIPTIONS = {
    FREE: 'Perfect for trying ChatSVG and learning',
    SUPPORTER: 'Help keep ChatSVG running with more credits and priority support',
};
