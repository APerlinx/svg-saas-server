import cron from 'node-cron'
import { cleanupExpiredTokens } from './cleanupExpiredTokens'
import { logger } from '../lib/logger'

// This sets up the schedule for all jobs
export function startScheduledJobs() {
  // Run cleanup every day at 3 AM
  cron.schedule('0 3 * * *', async () => {
    logger.info('Running scheduled token cleanup...')
    await cleanupExpiredTokens()
  })

  logger.info('Scheduled jobs initialized')
}
