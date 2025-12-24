import express from 'express'
import cors from 'cors'
import userRoutes from './routes/user.routes'
import authRoutes from './routes/auth.routes'
import svgRoutes from './routes/svg.routes'
import passport from './config/passport'
import { FRONTEND_URL, IS_PRODUCTION } from './config/env'
import cookieParser from 'cookie-parser'
import { generateCsrfToken, validateCsrfToken } from './middleware/csrf'
import { apiLimiter } from './middleware/rateLimiter'
import pinoHttp from 'pino-http'
import { logger } from './lib/logger'
import * as Sentry from '@sentry/node'
import { requestIdMiddleware } from './middleware/requestId'
import prisma from './lib/prisma'

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

// Add request ID tracking
app.use(requestIdMiddleware)

// Add CSRF token generation middleware
app.use((req, res, next) => {
  if (req.path === '/health') return next()
  return generateCsrfToken(req, res, next)
})

// Initialize Passport middleware
app.use(passport.initialize())

// Attach pino HTTP logger with requestId
app.use(
  pinoHttp({
    logger,
    customProps: (req) => ({
      requestId: req.requestId,
    }),
  })
)

// Health check endpoint (simple liveness check)
app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true })
})

// Readiness check (database + future Redis connectivity)
app.get('/api/ready', async (req, res) => {
  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`

    // TODO: Add Redis check when implemented
    // await redis.ping()

    res.status(200).json({
      ok: true,
      database: 'connected',
      // redis: 'connected'
    })
  } catch (error) {
    logger.error({ error }, 'Readiness check failed')
    res.status(503).json({
      ok: false,
      database: 'disconnected',
      error: 'Service unavailable',
    })
  }
})

app.use('/api', apiLimiter)

// CSRF token endpoint
app.get('/api/csrf', (req, res) => {
  res.json({ csrfToken: req.cookies['csrf-token'] })
})

//Auth
app.use('/api/auth', authRoutes)
// users
app.use('/api/user', validateCsrfToken, userRoutes)
// SVG generation
app.use('/api/svg', validateCsrfToken, svgRoutes)

// Generic error handler
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    // Log error with Pino
    logger.error(
      { error: err, path: req.path, requestId: req.requestId },
      'Unhandled error'
    )

    // Capture error in Sentry (production only)
    if (IS_PRODUCTION && process.env.SENTRY_DSN) {
      Sentry.captureException(err)
    }

    res.status(500).json({
      error: 'Internal server error',
      requestId: req.requestId,
    })
  }
)

export default app
