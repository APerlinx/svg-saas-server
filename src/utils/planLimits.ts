/**
 * Plan limits and features configuration
 * Single source of truth for all plan-related limits
 */

export type PlanType = 'FREE' | 'PRO' | 'ENTERPRISE'

export interface PlanLimits {
  // Credits
  creditsPerMonth: number
  overagePrice?: number // Price per additional credit (only for paid plans)

  // API Access
  apiAccess: boolean
  maxApiKeys: number
  apiCallsPerMonth: number

  // Rate Limits
  rateLimits: {
    perMinute: number
    perHour: number
    perDay: number
  }

  // Daily Generation Limits (for web app)
  dailyGenerations: number

  // Support
  supportLevel: 'community' | 'email' | 'priority' | 'dedicated'
  supportChannel?: 'email' | 'slack'
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  FREE: {
    // Credits
    creditsPerMonth: 3,

    // API Access
    apiAccess: false,
    maxApiKeys: 0,
    apiCallsPerMonth: 0,

    // Rate Limits
    rateLimits: {
      perMinute: 10,
      perHour: 100,
      perDay: 200,
    },

    // Daily Generation Limits
    dailyGenerations: 50,

    // Support
    supportLevel: 'community',
  },

  PRO: {
    // Credits
    creditsPerMonth: 100,
    overagePrice: 0.1, // $0.10 per credit

    // API Access
    apiAccess: true,
    maxApiKeys: 3,
    apiCallsPerMonth: 10000,

    // Rate Limits
    rateLimits: {
      perMinute: 60,
      perHour: 1000,
      perDay: 5000,
    },

    // Daily Generation Limits
    dailyGenerations: 500,

    // Support
    supportLevel: 'priority',
    supportChannel: 'email',
  },

  ENTERPRISE: {
    // Credits
    creditsPerMonth: 1000,
    overagePrice: 0.08, // $0.08 per credit (discounted)

    // API Access
    apiAccess: true,
    maxApiKeys: 20,
    apiCallsPerMonth: 100000,

    // Rate Limits
    rateLimits: {
      perMinute: 300,
      perHour: 10000,
      perDay: Infinity,
    },

    // Daily Generation Limits
    dailyGenerations: Infinity,

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
    apiCallsUsed?: number
  },
): { shouldUpgrade: boolean; recommendedPlan?: PlanType; reason?: string } {
  if (currentPlan === 'ENTERPRISE') {
    return { shouldUpgrade: false }
  }

  const currentLimits = PLAN_LIMITS[currentPlan]

  // Check if user needs API access
  if (
    !currentLimits.apiAccess &&
    usage.apiCallsUsed &&
    usage.apiCallsUsed > 0
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

  // Check if user is hitting API call limits
  if (
    usage.apiCallsUsed &&
    usage.apiCallsUsed >= currentLimits.apiCallsPerMonth * 0.8
  ) {
    return {
      shouldUpgrade: true,
      recommendedPlan: 'ENTERPRISE',
      reason: `You're using ${usage.apiCallsUsed} of ${currentLimits.apiCallsPerMonth} API calls`,
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
