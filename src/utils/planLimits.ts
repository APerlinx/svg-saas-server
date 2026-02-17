/**
 * Plan limits and features configuration
 * Single source of truth for all plan-related limits
 */

import { logger } from '../lib/logger'

export type PlanType = 'FREE' | 'SUPPORTER'

export interface PlanLimits {
  // Credits
  startingCredits: number // Initial credits on plan activation
  creditRefillAmount: number // Credits added each refill cycle
  creditRefillDays: number // Refill cycle length in days

  // Unified generation limit (web + API)
  generationsPerMonth: number

  // API Access
  apiAccess: boolean
  maxApiKeys: number

  // Request rate limits
  rateLimits: {
    perMinute: number
    perHour: number
    perDay: number
  }

  // Support
  supportLevel: 'community' | 'email' | 'priority'
  supportChannel?: 'email' | 'discord'
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
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
} as const

/**
 * Get plan limits for a specific plan
 */
export function getPlanLimits(plan: PlanType): PlanLimits {
  if (plan in PLAN_LIMITS) {
    return PLAN_LIMITS[plan]
  }

  // Default to FREE if unknown plan
  logger.warn({ plan }, 'Unknown plan type, defaulting to FREE')
  return PLAN_LIMITS.FREE
}

/**
 * Check if a plan has a specific feature
 */
export function hasFeature(plan: PlanType, feature: keyof PlanLimits): boolean {
  const limits = getPlanLimits(plan)
  const value = limits[feature]

  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value > 0
  }

  return !!value
}

/**
 * Check if user can create more API keys
 */
export function canCreateApiKey(
  plan: PlanType,
  currentKeyCount: number,
): boolean {
  const limits = getPlanLimits(plan)

  if (!limits.apiAccess) {
    return false
  }

  return currentKeyCount < limits.maxApiKeys
}

/**
 * Get upgrade recommendation based on current usage
 */
export function getUpgradeRecommendation(
  currentPlan: PlanType,
  usage: {
    creditsUsed?: number
    generationsUsed?: number
  },
): { shouldUpgrade: boolean; recommendedPlan?: PlanType; reason?: string } {
  // Already on SUPPORTER (highest tier)
  if (currentPlan === 'SUPPORTER') {
    return { shouldUpgrade: false }
  }

  const currentLimits = getPlanLimits(currentPlan)

  // Check if user is hitting generation limits
  if (
    usage.generationsUsed &&
    usage.generationsUsed >= currentLimits.generationsPerMonth * 0.8
  ) {
    return {
      shouldUpgrade: true,
      recommendedPlan: 'SUPPORTER',
      reason: `You're using ${usage.generationsUsed} of ${currentLimits.generationsPerMonth} generations`,
    }
  }

  // Check if user needs more credits
  if (
    usage.creditsUsed &&
    usage.creditsUsed >= currentLimits.startingCredits * 0.8
  ) {
    return {
      shouldUpgrade: true,
      recommendedPlan: 'SUPPORTER',
      reason:
        'Consider becoming a supporter for more credits and higher rate limits',
    }
  }

  return { shouldUpgrade: false }
}

/**
 * Get monthly price for each plan (in dollars)
 */
export const PLAN_PRICES: Record<PlanType, number> = {
  FREE: 0,
  SUPPORTER: 5,
} as const

/**
 * Plan display names for UI
 */
export const PLAN_NAMES: Record<PlanType, string> = {
  FREE: 'Free',
  SUPPORTER: 'Supporter',
} as const

/**
 * Plan descriptions for marketing
 */
export const PLAN_DESCRIPTIONS: Record<PlanType, string> = {
  FREE: 'Perfect for trying ChatSVG and learning',
  SUPPORTER: 'Help keep ChatSVG running with more credits and priority support',
} as const
