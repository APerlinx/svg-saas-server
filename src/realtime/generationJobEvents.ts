import type { Server as SocketIOServer } from 'socket.io'
import { QueueEvents } from 'bullmq'
import prisma from '../lib/prisma'
import { createBullMqConnection } from '../lib/bullmq'
import { logger } from '../lib/logger'
import {
  SVG_GENERATION_QUEUE_NAME,
  svgGenerationQueue,
} from '../jobs/svgGenerationQueue'
import { GenerationJobStatus } from '@prisma/client'

type JobUpdatePayload = {
  jobId: string
  status: GenerationJobStatus
  progress?: number
  generationId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}

export async function startGenerationJobRealtimeEvents(io: SocketIOServer) {
  const connection = createBullMqConnection('svg-generation-queue-events')
  const queueEvents = new QueueEvents(SVG_GENERATION_QUEUE_NAME, {
    connection,
  })

  await queueEvents.waitUntilReady()

  const userIdCache = new Map<string, string>()

  async function resolveUserId(jobId: string): Promise<string | null> {
    const cached = userIdCache.get(jobId)
    if (cached) return cached

    try {
      const job = await svgGenerationQueue.getJob(jobId)
      const userId = job?.data?.userId
      if (userId) {
        userIdCache.set(jobId, userId)
        return userId
      }
    } catch (error) {
      logger.debug({ error, jobId }, 'Failed to resolve userId from BullMQ job')
    }

    const record = await prisma.generationJob.findUnique({
      where: { id: jobId },
      select: { userId: true },
    })

    if (record?.userId) {
      userIdCache.set(jobId, record.userId)
      return record.userId
    }

    return null
  }

  function emitToUser(userId: string, payload: JobUpdatePayload) {
    io.to(`user:${userId}`).emit('generation-job:update', payload)
  }

  queueEvents.on('active', async ({ jobId }) => {
    const userId = await resolveUserId(jobId)
    if (!userId) return

    emitToUser(userId, { jobId, status: GenerationJobStatus.RUNNING })
  })

  queueEvents.on('progress', async ({ jobId, data }) => {
    const userId = await resolveUserId(jobId)
    if (!userId) return

    const progress = typeof data === 'number' ? data : undefined
    emitToUser(userId, {
      jobId,
      status: GenerationJobStatus.RUNNING,
      progress,
    })
  })

  queueEvents.on('completed', async ({ jobId }) => {
    const userId = await resolveUserId(jobId)
    if (!userId) return

    const job = await prisma.generationJob.findUnique({
      where: { id: jobId },
      select: {
        status: true,
        generationId: true,
        errorCode: true,
        errorMessage: true,
      },
    })

    emitToUser(userId, {
      jobId,
      status: job?.status ?? GenerationJobStatus.SUCCEEDED,
      generationId: job?.generationId ?? null,
      errorCode: job?.errorCode ?? null,
      errorMessage: job?.errorMessage ?? null,
      progress: 100,
    })
  })

  queueEvents.on('failed', async ({ jobId, failedReason }) => {
    const userId = await resolveUserId(jobId)
    if (!userId) return

    const job = await prisma.generationJob.findUnique({
      where: { id: jobId },
      select: {
        status: true,
        generationId: true,
        errorCode: true,
        errorMessage: true,
      },
    })

    emitToUser(userId, {
      jobId,
      status: job?.status ?? GenerationJobStatus.FAILED,
      generationId: job?.generationId ?? null,
      errorCode: job?.errorCode ?? null,
      errorMessage: job?.errorMessage ?? failedReason ?? null,
    })
  })

  queueEvents.on('error', (error) => {
    logger.error({ error }, 'BullMQ QueueEvents error (realtime)')
  })

  logger.info('Generation job realtime events started')

  return queueEvents
}
