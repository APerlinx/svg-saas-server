import { Plan } from '@prisma/client'
import { Request, Response, Router } from 'express'
import { FRONTEND_URL, PAYPAL_ENABLED } from '../config/env'
import { authMiddleware } from '../middleware/auth'
import { logger } from '../lib/logger'
import prisma from '../lib/prisma'
import {
  cancelPayPalSubscription,
  createPayPalSubscription,
  getPayPalSubscription,
  verifyPayPalWebhookSignature,
} from '../lib/paypal'
import { requireUserId } from '../utils/getUserId'
import { getPlanLimits } from '../utils/planLimits'

const router = Router()
const prismaAny = prisma as any

interface PayPalWebhookEvent {
  id: string
  event_type: string
  resource?: Record<string, any>
}

function disabledResponse(res: Response) {
  return res.status(503).json({ error: 'PayPal billing is not enabled' })
}

function getReturnAndCancelUrls() {
  const returnUrl =
    process.env.PAYPAL_RETURN_URL || `${FRONTEND_URL}/billing/paypal/success`
  const cancelUrl =
    process.env.PAYPAL_CANCEL_URL || `${FRONTEND_URL}/billing/paypal/cancel`

  return { returnUrl, cancelUrl }
}

async function upgradeUserToSupporter(userId: string) {
  const now = new Date()
  const supporterLimits = getPlanLimits('SUPPORTER')

  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })

  if (!existingUser) return

  const nextRefill = new Date(now)
  nextRefill.setDate(nextRefill.getDate() + supporterLimits.creditRefillDays)

  await prisma.user.update({
    where: { id: userId },
    data: {
      plan: Plan.SUPPORTER,
      creditRefillAmount: supporterLimits.creditRefillAmount,
      lastCreditRefillAt: now,
      nextCreditRefillAt: nextRefill,
      generationsQuotaLimit: supporterLimits.generationsPerMonth,
      ...(existingUser.plan !== Plan.SUPPORTER
        ? { credits: { increment: supporterLimits.startingCredits } }
        : {}),
    },
  })
}

async function applyRecurringSupporterCredits(userId: string) {
  const limits = getPlanLimits('SUPPORTER')

  await prisma.user.update({
    where: { id: userId },
    data: {
      credits: { increment: limits.creditRefillAmount },
    },
  })
}

async function downgradeUserToFree(userId: string) {
  const freeLimits = getPlanLimits('FREE')

  await prismaAny.user.update({
    where: { id: userId },
    data: {
      plan: Plan.FREE,
      creditRefillAmount: freeLimits.creditRefillAmount,
      generationsQuotaLimit: freeLimits.generationsPerMonth,
      paypalSubscriptionStatus: 'CANCELLED',
    },
  })
}

function extractResourceId(event: PayPalWebhookEvent): string | null {
  const candidate =
    event.resource?.id ||
    event.resource?.billing_agreement_id ||
    event.resource?.supplementary_data?.related_ids?.subscription_id

  if (typeof candidate !== 'string' || !candidate.trim()) {
    return null
  }

  return candidate
}

async function getUserIdForWebhookEvent(
  event: PayPalWebhookEvent,
): Promise<string | null> {
  const customId = event.resource?.custom_id

  if (typeof customId === 'string' && customId.trim().length > 0) {
    const exists = await prisma.user.findUnique({
      where: { id: customId.trim() },
      select: { id: true },
    })

    if (exists) return exists.id
  }

  const subscriptionId = extractResourceId(event)
  if (!subscriptionId) return null

  const user = await prismaAny.user.findFirst({
    where: { paypalSubscriptionId: subscriptionId },
    select: { id: true },
  })

  return user?.id ?? null
}

function getHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) return value[0]
  return value
}

router.post(
  '/create-subscription',
  authMiddleware,
  async (req: Request, res: Response) => {
    if (!PAYPAL_ENABLED) {
      return disabledResponse(res)
    }

    try {
      const userId = requireUserId(req)
      const { returnUrl, cancelUrl } = getReturnAndCancelUrls()

      const subscription = await createPayPalSubscription({
        userId,
        returnUrl,
        cancelUrl,
      })

      const approveUrl =
        subscription.links?.find((link) => link.rel === 'approve')?.href || null

      await prismaAny.user.update({
        where: { id: userId },
        data: {
          paypalSubscriptionId: subscription.id,
          paypalSubscriptionStatus: subscription.status,
        },
      })

      return res.status(201).json({
        subscriptionId: subscription.id,
        status: subscription.status,
        approveUrl,
      })
    } catch (error) {
      logger.error(
        { error, userId: requireUserId(req) },
        'PayPal create failed',
      )
      return res.status(500).json({ error: 'Failed to create subscription' })
    }
  },
)

router.post(
  '/subscription/cancel',
  authMiddleware,
  async (req: Request, res: Response) => {
    if (!PAYPAL_ENABLED) {
      return disabledResponse(res)
    }

    try {
      const userId = requireUserId(req)
      const user = await prismaAny.user.findUnique({
        where: { id: userId },
        select: { paypalSubscriptionId: true },
      })

      if (!user?.paypalSubscriptionId) {
        return res.status(400).json({ error: 'No active PayPal subscription' })
      }

      await cancelPayPalSubscription(user.paypalSubscriptionId)

      await prismaAny.user.update({
        where: { id: userId },
        data: {
          paypalSubscriptionStatus: 'CANCELLED',
        },
      })

      return res.json({ ok: true })
    } catch (error) {
      logger.error(
        { error, userId: requireUserId(req) },
        'PayPal cancel subscription failed',
      )
      return res.status(500).json({ error: 'Failed to cancel subscription' })
    }
  },
)

router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  if (!PAYPAL_ENABLED) {
    return disabledResponse(res)
  }

  try {
    const userId = requireUserId(req)

    const user = await prismaAny.user.findUnique({
      where: { id: userId },
      select: {
        plan: true,
        credits: true,
        paypalSubscriptionId: true,
        paypalSubscriptionStatus: true,
        paypalCustomerId: true,
        paypalPlanId: true,
      },
    })

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    let remoteSubscription: Awaited<
      ReturnType<typeof getPayPalSubscription>
    > | null = null

    if (user.paypalSubscriptionId) {
      try {
        remoteSubscription = await getPayPalSubscription(
          user.paypalSubscriptionId,
        )
      } catch (error) {
        logger.warn(
          { error, userId, subscriptionId: user.paypalSubscriptionId },
          'Failed to fetch PayPal subscription status',
        )
      }
    }

    return res.json({
      plan: user.plan,
      credits: user.credits,
      paypal: {
        customerId: user.paypalCustomerId,
        subscriptionId: user.paypalSubscriptionId,
        status: user.paypalSubscriptionStatus,
        planId: user.paypalPlanId,
        remote: remoteSubscription,
      },
    })
  } catch (error) {
    logger.error({ error, userId: requireUserId(req) }, 'PayPal status failed')
    return res.status(500).json({ error: 'Failed to fetch billing status' })
  }
})

export const paypalWebhookHandler = async (req: Request, res: Response) => {
  if (!PAYPAL_ENABLED) {
    return res.status(503).json({ error: 'PayPal billing is not enabled' })
  }

  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : JSON.stringify(req.body || {})

  let event: PayPalWebhookEvent

  try {
    event = JSON.parse(rawBody) as PayPalWebhookEvent
  } catch (error) {
    logger.warn({ error }, 'Invalid PayPal webhook JSON payload')
    return res.status(400).json({ error: 'Invalid payload' })
  }

  try {
    const signatureValid = await verifyPayPalWebhookSignature({
      headers: {
        'paypal-transmission-id': getHeaderValue(
          req.headers['paypal-transmission-id'],
        ),
        'paypal-transmission-time': getHeaderValue(
          req.headers['paypal-transmission-time'],
        ),
        'paypal-transmission-sig': getHeaderValue(
          req.headers['paypal-transmission-sig'],
        ),
        'paypal-cert-url': getHeaderValue(req.headers['paypal-cert-url']),
        'paypal-auth-algo': getHeaderValue(req.headers['paypal-auth-algo']),
      },
      rawBody,
    })

    if (!signatureValid) {
      logger.warn(
        { eventId: event.id, eventType: event.event_type },
        'Rejected PayPal webhook with invalid signature',
      )
      return res.status(400).json({ error: 'Invalid webhook signature' })
    }

    const resourceId = extractResourceId(event)
    const userId = await getUserIdForWebhookEvent(event)

    try {
      await (prisma as any).payPalWebhookEvent.create({
        data: {
          paypalEventId: event.id,
          eventType: event.event_type,
          resourceId,
          userId,
          rawPayload: event,
          receivedAt: new Date(),
        },
      })
    } catch (createError: any) {
      if (createError?.code === 'P2002') {
        return res.status(200).json({ ok: true, duplicate: true })
      }
      throw createError
    }

    if (!userId) {
      logger.warn(
        { eventId: event.id, eventType: event.event_type, resourceId },
        'PayPal webhook received but no matching user was found',
      )
      return res.status(200).json({ ok: true, ignored: true })
    }

    switch (event.event_type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        await upgradeUserToSupporter(userId)

        await prismaAny.user.update({
          where: { id: userId },
          data: {
            paypalSubscriptionId:
              extractResourceId(event) ||
              event.resource?.id ||
              event.resource?.billing_agreement_id ||
              null,
            paypalPlanId: event.resource?.plan_id || null,
            paypalSubscriptionStatus: event.resource?.status || 'ACTIVE',
            paypalCustomerId: event.resource?.subscriber?.payer_id || null,
          },
        })
        break
      }

      case 'PAYMENT.SALE.COMPLETED':
      case 'PAYMENT.CAPTURE.COMPLETED': {
        await applyRecurringSupporterCredits(userId)

        await prismaAny.user.update({
          where: { id: userId },
          data: {
            plan: Plan.SUPPORTER,
          },
        })
        break
      }

      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        await downgradeUserToFree(userId)
        break
      }

      case 'BILLING.SUBSCRIPTION.RE-ACTIVATED': {
        await upgradeUserToSupporter(userId)
        await prismaAny.user.update({
          where: { id: userId },
          data: {
            paypalSubscriptionStatus: event.resource?.status || 'ACTIVE',
          },
        })
        break
      }

      default:
        break
    }

    await (prisma as any).payPalWebhookEvent.updateMany({
      where: { paypalEventId: event.id },
      data: { processedAt: new Date(), processingError: null },
    })

    return res.status(200).json({ ok: true })
  } catch (error) {
    logger.error({ error, eventId: event.id }, 'PayPal webhook handler error')

    try {
      await (prisma as any).payPalWebhookEvent.updateMany({
        where: { paypalEventId: event.id },
        data: {
          processedAt: new Date(),
          processingError:
            error instanceof Error
              ? error.message.slice(0, 500)
              : 'Unknown webhook error',
        },
      })
    } catch {
      // best effort only
    }

    return res.status(500).json({ error: 'Webhook processing failed' })
  }
}

export default router
