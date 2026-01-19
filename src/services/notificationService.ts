import { NotificationType, Prisma } from '@prisma/client'
import prisma from '../lib/prisma'
import { logger } from '../lib/logger'

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

async function createNotificationOnce(args: {
  userId: string
  type: NotificationType
  message: string
  title?: string | null
  jobId?: string | null
  data?: Prisma.InputJsonValue
}) {
  try {
    return await prisma.notification.create({
      data: {
        userId: args.userId,
        type: args.type,
        title: args.title ?? null,
        message: args.message,
        jobId: args.jobId ?? null,
        data: args.data ?? undefined,
      },
    })
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return null

    logger.warn(
      { error, userId: args.userId, type: args.type, jobId: args.jobId },
      'Failed to create notification'
    )
    return null
  }
}

export async function createJobSucceededNotification(args: {
  userId: string
  jobId: string
  generationId?: string | null
}) {
  return createNotificationOnce({
    userId: args.userId,
    jobId: args.jobId,
    type: NotificationType.JOB_SUCCEEDED,
    title: 'SVG ready',
    message: 'Your SVG generation finished successfully.',
    data: args.generationId ? { generationId: args.generationId } : undefined,
  })
}

export async function createJobFailedNotification(args: {
  userId: string
  jobId: string
}) {
  return createNotificationOnce({
    userId: args.userId,
    jobId: args.jobId,
    type: NotificationType.JOB_FAILED,
    title: 'SVG generation failed',
    message:
      "Your SVG generation failed. If credits were charged, they should be refunded automatically. If you don't see a refund, please contact support.",
  })
}

export async function maybeCreateOutOfCreditsNotification(args: {
  userId: string
  jobId: string
}) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: args.userId },
      select: { credits: true },
    })

    if (!user) return null
    if (user.credits !== 0) return null

    return await createNotificationOnce({
      userId: args.userId,
      jobId: args.jobId,
      type: NotificationType.LOW_CREDITS,
      title: 'Out of credits',
      message:
        'We noticed you are out of credits. Just a reminder: you can buy more credits anytime.',
      data: { credits: 0 },
    })
  } catch (error) {
    logger.warn(
      { error, userId: args.userId },
      'Failed out-of-credits notification'
    )
    return null
  }
}
