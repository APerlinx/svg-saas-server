import cron from 'node-cron'
import { cleanupExpiredTokens } from './cleanupExpiredTokens'

// This sets up the schedule for all jobs
export function startScheduledJobs() {
  // Run cleanup every day at 3 AM
  cron.schedule('0 3 * * *', async () => {
    console.log('Running scheduled token cleanup...')
    await cleanupExpiredTokens()
  })

  console.log('Scheduled jobs initialized')
}
