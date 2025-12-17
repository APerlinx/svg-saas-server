import app from './app'
import { FRONTEND_URL, IS_PRODUCTION, PORT } from './config/env'
import { startScheduledJobs } from './jobs'
import { logger } from './lib/logger'

app.listen(PORT, () => {
  logger.info(`Server running at ${PORT}`)
  logger.info(`🌍 Environment: ${IS_PRODUCTION ? 'production' : 'development'}`)
  logger.info(`🛡️  CSRF protection: enabled`)
  logger.info(`🍪 Frontend URL: ${FRONTEND_URL}`)
  startScheduledJobs()
})
