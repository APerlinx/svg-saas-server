import { Router } from 'express'
import {
  canCreateApiKey,
  getPlanLimits,
  getUpgradeRecommendation,
  hasFeature,
  PLAN_DESCRIPTIONS,
  PLAN_LIMITS,
  PLAN_NAMES,
  PLAN_PRICES,
  type PlanLimits,
  type PlanType,
} from '../utils/planLimits'

const router = Router()
const PLAN_TYPES = Object.keys(PLAN_LIMITS) as PlanType[]
const PLAN_FEATURES = Object.keys(PLAN_LIMITS.FREE) as Array<keyof PlanLimits>

function isPlanType(value: unknown): value is PlanType {
  return typeof value === 'string' && PLAN_TYPES.includes(value as PlanType)
}

function parsePlanParam(value: unknown): PlanType | null {
  if (!isPlanType(value)) return null
  return value
}

function parseNonNegativeInt(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.floor(parsed)
}

function parseOptionalNonNegativeInt(
  value: unknown,
): number | undefined | null {
  if (value === undefined) return undefined
  return parseNonNegativeInt(value)
}

router.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300')

  const plans = PLAN_TYPES.reduce(
    (acc, plan) => {
      acc[plan] = {
        plan,
        name: PLAN_NAMES[plan],
        description: PLAN_DESCRIPTIONS[plan],
        price: PLAN_PRICES[plan],
        limits: PLAN_LIMITS[plan],
      }
      return acc
    },
    {} as Record<
      PlanType,
      {
        plan: PlanType
        name: string
        description: string
        price: number
        limits: (typeof PLAN_LIMITS)[PlanType]
      }
    >,
  )

  res.json({ plans })
})

router.get('/limits/:plan', (req, res) => {
  const plan = parsePlanParam(req.params.plan)
  if (!plan) {
    return res.status(400).json({ error: 'Invalid plan' })
  }

  return res.json({ plan, limits: getPlanLimits(plan) })
})

router.get('/has-feature', (req, res) => {
  const plan = parsePlanParam(req.query.plan)
  const feature = req.query.feature

  if (!plan) {
    return res.status(400).json({ error: 'Invalid plan' })
  }

  if (typeof feature !== 'string' || !PLAN_FEATURES.includes(feature as any)) {
    return res.status(400).json({ error: 'Invalid feature' })
  }

  return res.json({
    plan,
    feature,
    hasFeature: hasFeature(plan, feature as keyof PlanLimits),
  })
})

router.get('/can-create-api-key', (req, res) => {
  const plan = parsePlanParam(req.query.plan)
  const currentKeyCount = parseNonNegativeInt(req.query.currentKeyCount)

  if (!plan) {
    return res.status(400).json({ error: 'Invalid plan' })
  }

  if (currentKeyCount === null) {
    return res.status(400).json({ error: 'Invalid currentKeyCount' })
  }

  return res.json({
    plan,
    currentKeyCount,
    canCreateApiKey: canCreateApiKey(plan, currentKeyCount),
  })
})

router.post('/recommendation', (req, res) => {
  const currentPlan = parsePlanParam((req.body as any)?.currentPlan)
  if (!currentPlan) {
    return res.status(400).json({ error: 'Invalid currentPlan' })
  }

  const creditsUsedRaw = (req.body as any)?.usage?.creditsUsed
  const generationsUsedRaw = (req.body as any)?.usage?.generationsUsed
  const creditsUsed = parseOptionalNonNegativeInt(creditsUsedRaw)
  const generationsUsed = parseOptionalNonNegativeInt(generationsUsedRaw)

  if (creditsUsed === null) {
    return res.status(400).json({ error: 'Invalid creditsUsed' })
  }

  if (generationsUsed === null) {
    return res.status(400).json({ error: 'Invalid generationsUsed' })
  }

  const recommendation = getUpgradeRecommendation(currentPlan, {
    creditsUsed,
    generationsUsed,
  })

  return res.json({
    currentPlan,
    usage: {
      creditsUsed,
      generationsUsed,
    },
    ...recommendation,
  })
})

export default router
