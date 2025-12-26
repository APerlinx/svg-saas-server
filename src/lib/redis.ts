import { createClient } from 'redis'
import { logger } from './logger'
import { REDIS_URL } from '../config/env'

export const redisClient = createClient({
  url: REDIS_URL,
})

redisClient.on('error', (err) => {
  logger.error({ error: err }, 'Redis client error')
})

redisClient.on('connect', () => {
  logger.info('Redis client connected')
})

redisClient.on('ready', () => {
  logger.info('Redis client ready')
})

// Connect to Redis
export async function connectRedis() {
  try {
    await redisClient.connect()
    logger.info('Redis connection established')
  } catch (error) {
    logger.error({ error }, 'Failed to connect to Redis')
    // Don't crash the app if Redis is unavailable
    // App can still work without caching
  }
}

// Graceful shutdown
export async function disconnectRedis() {
  try {
    await redisClient.quit()
    logger.info('Redis connection closed')
  } catch (error) {
    logger.error({ error }, 'Error closing Redis connection')
  }
}
