import app from './app'
import { FRONTEND_URL, IS_PRODUCTION, PORT } from './config/env'
import { startScheduledJobs } from './jobs'

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
  console.log(`🌍 Environment: ${IS_PRODUCTION ? 'production' : 'development'}`)
  console.log(`🛡️  CSRF protection: enabled`)
  console.log(`🍪 Frontend URL: ${FRONTEND_URL}`)
  startScheduledJobs()
})
