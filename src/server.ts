import app from './app'
import { PORT } from './config/env'
import { startScheduledJobs } from './jobs'

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
  startScheduledJobs()
})
