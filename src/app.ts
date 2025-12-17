import express from 'express'
import cors from 'cors'
import userRoutes from './routes/user.routes'
import authRoutes from './routes/auth.routes'
import svgRoutes from './routes/svg.routes'
import passport from './config/passport'
import { FRONTEND_URL } from './config/env'
import cookieParser from 'cookie-parser'
import { generateCsrfToken, validateCsrfToken } from './middleware/csrf'
import { apiLimiter } from './middleware/rateLimiter'
import pinoHttp from 'pino-http'
import { logger } from './lib/logger'

const app = express()

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_PREVIEW_REGEX,
].filter(Boolean)

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true)
      if (origin === process.env.FRONTEND_URL) return cb(null, true)

      if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return cb(null, true)

      return cb(new Error('Not allowed by CORS'))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  })
)

app.use(express.json())
app.use(cookieParser())

// Add CSRF token generation middleware
app.use((req, res, next) => {
  if (req.path === '/health') return next()
  return generateCsrfToken(req, res, next)
})

// Initialize Passport middleware
app.use(passport.initialize())

// Attach pino HTTP logger
app.use(pinoHttp({ logger }))

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true })
})
app.use('/api', apiLimiter)
//Auth
app.use('/api/auth', authRoutes)
// users
app.use('/api/user', validateCsrfToken, userRoutes)
// SVG generation
app.use('/api/svg', validateCsrfToken, svgRoutes)

export default app
