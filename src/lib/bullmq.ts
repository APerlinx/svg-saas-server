import IORedis from 'ioredis'
import { REDIS_URL } from '../config/env'
import { logger } from './logger'

export function createBullMqConnection(context: string) {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })

  connection.on('connect', () =>
    logger.info({ context }, 'BullMQ Redis connected')
  )
  connection.on('reconnecting', () =>
    logger.warn({ context }, 'BullMQ Redis reconnecting')
  )
  connection.on('error', (error) => {
    logger.error({ error, context }, 'BullMQ Redis connection error')
  })

  return connection
}
