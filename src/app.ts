import express from 'express'
import cors from 'cors'
import userRoutes from './routes/user.routes'
import authRoutes from './routes/auth.routes'
import svgRoutes from './routes/svg.routes'
import passport from './config/passport'
import { FRONTEND_URL } from './config/env'
import cookieParser from 'cookie-parser'

const app = express()

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)

app.use(express.json())
app.use(cookieParser())

// Initialize Passport middleware
app.use(passport.initialize())

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.send('OK')
})

// users
app.use('/api/user', userRoutes)
//Auth
app.use('/api/auth', authRoutes)
// SVG generation
app.use('/api/svg', svgRoutes)

export default app
