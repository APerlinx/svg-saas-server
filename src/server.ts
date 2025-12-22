import { IS_PRODUCTION, PORT, FRONTEND_URL, NODE_ENV } from './config/env'
import * as Sentry from '@sentry/node'

// Initialize Sentry in production only
if (IS_PRODUCTION && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: NODE_ENV,
    tracesSampleRate: 1.0,
  })
}

import app from './app'
import { startScheduledJobs } from './jobs'
import { logger } from './lib/logger'

app.listen(PORT, () => {
  logger.info(`Server running at ${PORT}`)
  logger.info(`🌍 Environment: ${IS_PRODUCTION ? 'production' : 'development'}`)
  logger.info(`🛡️  CSRF protection: enabled`)
  logger.info(`🍪 Frontend URL: ${FRONTEND_URL}`)
  startScheduledJobs()
})
