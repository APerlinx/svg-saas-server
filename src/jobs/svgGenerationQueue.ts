import { Queue, JobsOptions } from 'bullmq'
import { createBullMqConnection } from '../lib/bullmq'
import { logger } from '../lib/logger'

export const SVG_GENERATION_QUEUE_NAME = 'svg-generation'

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  removeOnComplete: {
    age: 60 * 60,
    count: 1000,
  },
  removeOnFail: {
    age: 24 * 60 * 60,
  },
  backoff: {
    type: 'exponential',
    delay: 5_000,
  },
}

const queueConnection = createBullMqConnection('svg-generation-queue')

export const svgGenerationQueue = new Queue<{
  jobId: string
  userId: string
}>(SVG_GENERATION_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions,
})

export async function enqueueSvgGenerationJob(jobId: string, userId: string) {
  try {
    await svgGenerationQueue.add(
      'generate-svg',
      { jobId, userId },
      {
        jobId,
      }
    )
  } catch (error) {
    if (isJobIdAlreadyExistsError(error)) {
      logger.debug({ jobId }, 'Generation job already enqueued')
      return
    }

    throw error
  }
}

function isJobIdAlreadyExistsError(error: unknown) {
  if (error instanceof Error) {
    const normalized = error.message.toLowerCase()
    return (
      error.name === 'JobIdAlreadyExistsError' ||
      (normalized.includes('job') && normalized.includes('already exists'))
    )
  }

  return false
}
