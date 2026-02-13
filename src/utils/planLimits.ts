/**
 * Plan limits and features configuration
 * Single source of truth for all plan-related limits
 */

export type PlanType = 'FREE' | 'PRO' | 'ENTERPRISE'

export interface PlanLimits {
  // Credits
  creditsPerMonth: number
  overagePrice?: number // Price per additional credit (only for paid plans)

  // Unified Generation Limits (applies to both web app + API)
  generationsPerMonth: number

  // API Access
  apiAccess: boolean
  maxApiKeys: number

  // Rate Limits (requests per time window, not generations)
  rateLimits: {
    perMinute: number
    perHour: number
    perDay: number
  }

  // Support
  supportLevel: 'community' | 'email' | 'priority' | 'dedicated'
  supportChannel?: 'email' | 'slack'
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  FREE: {
    // Credits
    creditsPerMonth: 3,

    // Unified Generations (web + API combined)
    generationsPerMonth: 1000,

    // API Access
    apiAccess: false,
    maxApiKeys: 0,

    // Rate Limits
    rateLimits: {
      perMinute: 10,
      perHour: 100,
      perDay: 200,
    },

    // Support
    supportLevel: 'community',
  },

  PRO: {
    // Credits
    creditsPerMonth: 100,
    overagePrice: 0.1, // $0.10 per credit

    // Unified Generations (web + API combined)
    generationsPerMonth: 10000,

    // API Access
    apiAccess: true,
    maxApiKeys: 3,

    // Rate Limits
    rateLimits: {
      perMinute: 60,
      perHour: 1000,
      perDay: 5000,
    },

    // Support
    supportLevel: 'priority',
    supportChannel: 'email',
  },

  ENTERPRISE: {
    // Credits
    creditsPerMonth: 1000,
    overagePrice: 0.08, // $0.08 per credit (discounted)

    // Unified Generations (web + API combined)
    generationsPerMonth: 100000,

    // API Access
    apiAccess: true,
    maxApiKeys: 20,

    // Rate Limits
    rateLimits: {
      perMinute: 300,
      perHour: 10000,
      perDay: Infinity,
    },

    // Support
    supportLevel: 'dedicated',
    supportChannel: 'slack',
  },
} as const

/**
 * Get plan limits for a specific plan
 */
export function getPlanLimits(plan: PlanType): PlanLimits {
  return PLAN_LIMITS[plan]
}

/**
 * Check if a plan has a specific feature
 */
export function hasFeature(plan: PlanType, feature: keyof PlanLimits): boolean {
  const limits = PLAN_LIMITS[plan]
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
  const limits = PLAN_LIMITS[plan]

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
  if (currentPlan === 'ENTERPRISE') {
    return { shouldUpgrade: false }
  }

  const currentLimits = PLAN_LIMITS[currentPlan]

  // Check if user needs API access
  if (
    !currentLimits.apiAccess &&
    usage.generationsUsed &&
    usage.generationsUsed > 0
  ) {
    return {
      shouldUpgrade: true,
      recommendedPlan: 'PRO',
      reason: 'API access requires PRO plan',
    }
  }

  // Check if user is hitting credit limits
  if (
    usage.creditsUsed &&
    usage.creditsUsed >= currentLimits.creditsPerMonth * 0.8
  ) {
    const nextPlan = currentPlan === 'FREE' ? 'PRO' : 'ENTERPRISE'
    return {
      shouldUpgrade: true,
      recommendedPlan: nextPlan,
      reason: `You're using ${usage.creditsUsed} of ${currentLimits.creditsPerMonth} credits`,
    }
  }

  // Check if user is hitting generation limits
  if (
    usage.generationsUsed &&
    usage.generationsUsed >= currentLimits.generationsPerMonth * 0.8
  ) {
    const nextPlan = currentPlan === 'FREE' ? 'PRO' : 'ENTERPRISE'
    return {
      shouldUpgrade: true,
      recommendedPlan: nextPlan,
      reason: `You're using ${usage.generationsUsed} of ${currentLimits.generationsPerMonth} generations`,
    }
  }

  return { shouldUpgrade: false }
}

/**
 * Get monthly price for each plan (in dollars)
 */
export const PLAN_PRICES: Record<PlanType, number> = {
  FREE: 0,
  PRO: 29,
  ENTERPRISE: 99,
} as const

/**
 * Plan display names for UI
 */
export const PLAN_NAMES: Record<PlanType, string> = {
  FREE: 'Free',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise',
} as const

/**
 * Plan descriptions for marketing
 */
export const PLAN_DESCRIPTIONS: Record<PlanType, string> = {
  FREE: 'Try ChatSVG for free',
  PRO: 'For developers and small teams',
  ENTERPRISE: 'For agencies and high-volume apps',
} as const
