import express from 'express'
import cors from 'cors'
import userRoutes from './routes/user.routes'
import authRoutes from './routes/auth.routes'

const app = express()

app.use(cors())
app.use(express.json())

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('OK')
})

// users
app.use('/users', userRoutes)
//Auth
app.use('/auth', authRoutes)

export default app
