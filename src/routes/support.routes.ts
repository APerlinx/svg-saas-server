import { Router, Request, Response } from 'express'
import { optionalAuthMiddleware } from '../middleware/auth'
import { getUserId } from '../utils/getUserId'
import { logger } from '../lib/logger'
import { sanitizeInput } from '../utils/sanitizeInput'
import { getUserIp } from '../utils/getUserIp'
import { supportMessageLimiter } from '../middleware/rateLimiter'
import prisma from '../lib/prisma'
import {
  sendSupportConfirmationEmail,
  sendSupportMessageEmail,
  type SubmitSupportMessagePayload,
  type SupportMessageType,
} from '../services/emailService'

const router = Router()

const SUPPORT_TYPES: SupportMessageType[] = ['contact', 'bug', 'idea']

function isSupportType(value: unknown): value is SupportMessageType {
  return (
    typeof value === 'string' && (SUPPORT_TYPES as string[]).includes(value)
  )
}

function asOptionalTrimmedString(
  value: unknown,
  maxLen: number,
): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = sanitizeInput(value)
  if (!trimmed) return undefined
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed
}

function asRequiredTrimmedString(
  value: unknown,
  maxLen: number,
): string | null {
  if (typeof value !== 'string') return null
  const trimmed = sanitizeInput(value)
  if (!trimmed) return null
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed
}

function isValidEmail(email: string): boolean {
  if (email.length > 254) return false
  return email.includes('@')
}

router.post(
  '/contact',
  supportMessageLimiter,
  optionalAuthMiddleware,
  async (req: Request, res: Response) => {
    try {
      const typeRaw = (req.body as any)?.type
      const subject = asRequiredTrimmedString((req.body as any)?.subject, 200)
      const message = asRequiredTrimmedString((req.body as any)?.message, 8000)

      const bodyEmail = asOptionalTrimmedString(
        (req.body as any)?.email,
        254,
      )?.toLowerCase()

      const authedUserId = getUserId(req)
      const userId = authedUserId

      const contextUrl = asOptionalTrimmedString(
        (req.body as any)?.contextUrl,
        2048,
      )
      const userAgent =
        asOptionalTrimmedString((req.body as any)?.userAgent, 512) ||
        asOptionalTrimmedString(req.get('User-Agent'), 512)

      if (!isSupportType(typeRaw)) {
        return res.status(400).json({ error: 'Invalid support message type' })
      }
      if (!subject || !message) {
        return res
          .status(400)
          .json({ error: 'Subject and message are required' })
      }

      if (bodyEmail && !isValidEmail(bodyEmail)) {
        return res.status(400).json({ error: 'Invalid email format' })
      }

      let resolvedEmail = bodyEmail

      if (authedUserId) {
        const user = await prisma.user.findUnique({
          where: { id: authedUserId },
          select: { email: true },
        })
        if (user?.email) {
          resolvedEmail = user.email.toLowerCase()
        }
      }

      if (!resolvedEmail) {
        return res.status(400).json({
          error: 'Email is required when not logged in',
        })
      }
      if (!isValidEmail(resolvedEmail)) {
        return res.status(400).json({ error: 'Invalid email format' })
      }

      const payload: SubmitSupportMessagePayload = {
        type: typeRaw,
        subject,
        message,
        email: resolvedEmail,
        userId,
        contextUrl,
        userAgent,
      }

      const ip = getUserIp(req)
      const requestId = (req as any).requestId as string | undefined

      await sendSupportMessageEmail(payload, { ip, requestId })

      await sendSupportConfirmationEmail(
        payload.email,
        payload.type,
        payload.subject,
      )

      return res.status(200).json({
        ok: true,
        message: 'Thank you — your message was received!',
      })
    } catch (error) {
      logger.error(
        { error, userId: getUserId(req) },
        'Error submitting support request',
      )
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

export default router
