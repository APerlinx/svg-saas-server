import express from 'express'
import cors from 'cors'
import * as Sentry from '@sentry/node'
import helmet from 'helmet'

import userRoutes from './routes/user.routes'
import authRoutes from './routes/auth.routes'
import svgRoutes from './routes/svg.routes'
import notificationRoutes from './routes/notification.routes'
import supportRoutes from './routes/support.routes'
import adminRoutes from './routes/admin.routes'
import apiKeysRoutes from './routes/apiKeys.routes'
import v1Routes from './routes/v1.routes'
import plansRoutes from './routes/plans.routes'
import oauthRoutes from './routes/oauth.routes'

import paypalRoutes, { paypalWebhookHandler } from './routes/paypal.routes'

import passport from './config/passport'
import {
  IS_PRODUCTION,
  FRONTEND_URL,
  PUBLIC_ASSETS_BASE_URL,
  TRUST_PROXY,
} from './config/env'
import cookieParser from 'cookie-parser'

import { generateCsrfToken, validateCsrfToken } from './middleware/csrf'
import { apiLimiter } from './middleware/rateLimiter'
import { requestIdMiddleware } from './middleware/requestId'

import { logger } from './lib/logger'
import pinoHttp from 'pino-http'

import prisma from './lib/prisma'
import { redisClient } from './lib/redis'
import { INSTANCE_ID } from './lib/instanceId'
import oauthWellKnownRoutes from './routes/oauthWellKnown.routes'

const app = express()

// Behind Cloudflare / reverse proxies, req.ip is only correct if trust proxy is configured.
// This affects rate limiting, security logging, and audit trails.
app.set('trust proxy', TRUST_PROXY)

const previewOriginRegex = process.env.FRONTEND_PREVIEW_REGEX
  ? new RegExp(process.env.FRONTEND_PREVIEW_REGEX)
  : null

// CORS configuration for web app routes
const webAppCorsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    if (origin === process.env.FRONTEND_URL) return cb(null, true)
    if (previewOriginRegex?.test(origin)) return cb(null, true)

    return cb(new Error('Not allowed by CORS'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'x-idempotency-key'],
}

// CORS configuration for public API routes
const publicApiCorsOptions: cors.CorsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
  credentials: false,
}

// Security headers
const cloudFrontDomain = PUBLIC_ASSETS_BASE_URL
  ? new URL(PUBLIC_ASSETS_BASE_URL).origin
  : null

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'", // React/Vite inline scripts
          "'unsafe-eval'", // Development hot reload
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'", // React inline styles, CSS-in-JS
        ],
        imgSrc: [
          "'self'",
          'data:', // Base64 images
          'blob:', // Blob URLs
          'https:', // CloudFront, S3 pre-signed URLs
          ...(cloudFrontDomain ? [cloudFrontDomain] : []),
        ],
        connectSrc: [
          "'self'",
          'ws:', // WebSocket (development)
          'wss:', // WebSocket (production)
          ...(FRONTEND_URL ? [FRONTEND_URL] : []),
        ],
        fontSrc: ["'self'", 'data:', 'https:'], // Google Fonts, etc.
        objectSrc: ["'none'"], // No Flash, Java, etc.
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"], // No iframes (prevent clickjacking)
        formAction: ["'self'"],
        upgradeInsecureRequests: IS_PRODUCTION ? [] : null, // Force HTTPS in production
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    frameguard: {
      action: 'deny', // X-Frame-Options: DENY
    },
    noSniff: true, // X-Content-Type-Options: nosniff
    xssFilter: true, // X-XSS-Protection: 1; mode=block (legacy browsers)
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },
  }),
)

// PayPal webhook must receive raw body for signature verification.
app.post(
  '/api/paypal/webhook',
  express.raw({ type: 'application/json' }),
  paypalWebhookHandler,
)

app.use(express.json())
app.use(cookieParser())
app.use(requestIdMiddleware)
app.use((req, res, next) => {
  res.setHeader('x-instance-id', INSTANCE_ID)
  next()
})

app.use((req, res, next) => {
  if (req.path === '/health') return next()
  return generateCsrfToken(req, res, next)
})

app.use(passport.initialize())

app.use(
  pinoHttp({
    logger,
    customProps: (req) => ({
      requestId: req.requestId,
    }),
  }),
)

app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true })
})

app.get('/api/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`

    let redisStatus = 'disconnected'
    try {
      if (redisClient.isReady) {
        await redisClient.ping()
        redisStatus = 'connected'
      }
    } catch (redisError) {
      logger.warn(
        { error: redisError },
        'Redis check failed in readiness probe',
      )
    }

    res.status(200).json({
      ok: true,
      database: 'connected',
      redis: redisStatus,
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

app.get('/api/csrf', cors(webAppCorsOptions), (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ csrfToken: req.cookies['csrf-token'] ?? (req as any).csrfToken })
})

// Web app routes - restrictive CORS
app.use('/api/auth', cors(webAppCorsOptions), authRoutes)
app.use('/api/plans', cors(webAppCorsOptions), plansRoutes)
app.use('/api/paypal', cors(webAppCorsOptions), validateCsrfToken, paypalRoutes)
app.use('/api/user', cors(webAppCorsOptions), validateCsrfToken, userRoutes)
app.use('/api/svg', cors(webAppCorsOptions), validateCsrfToken, svgRoutes)
app.use(
  '/api/notification',
  cors(webAppCorsOptions),
  validateCsrfToken,
  notificationRoutes,
)
app.use(
  '/api/support',
  cors(webAppCorsOptions),
  validateCsrfToken,
  supportRoutes,
)
app.use('/api/keys', cors(webAppCorsOptions), validateCsrfToken, apiKeysRoutes)
app.use('/api/admin', cors(webAppCorsOptions), adminRoutes)

// Public API routes - open CORS
app.use('/v1', cors(publicApiCorsOptions), v1Routes)
app.use('/.well-known', cors(publicApiCorsOptions), oauthWellKnownRoutes)
app.use('/oauth', cors(publicApiCorsOptions), oauthRoutes)
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    // Log error with Pino
    logger.error(
      { error: err, path: req.path, requestId: req.requestId },
      'Unhandled error',
    )

    // Capture error in Sentry (production only)
    if (IS_PRODUCTION && process.env.SENTRY_DSN) {
      Sentry.captureException(err)
    }

    res.status(500).json({
      error: 'Internal server error',
      requestId: req.requestId,
    })
  },
)

export default app
