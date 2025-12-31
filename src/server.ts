import {
  IS_PRODUCTION,
  PORT,
  FRONTEND_URL,
  NODE_ENV,
  JWT_SECRET,
  REDIS_URL,
  IS_TEST,
} from './config/env'
import * as Sentry from '@sentry/node'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { initIO } from './realtime/io'
import jwt from 'jsonwebtoken'
import type { JwtPayload } from './types/express'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'

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
import { connectRedis } from './lib/redis'
import { INSTANCE_ID } from './lib/instanceId'

// Connect to Redis
connectRedis().catch((err) => {
  logger.error({ error: err }, 'Failed to connect to Redis on startup')
})

const httpServer = createServer(app)

async function enableSocketIoRedisAdapter(io: SocketIOServer) {
  if (IS_TEST) return

  // recommend controlling via env so dev without Redis doesn't spam logs
  const enabled =
    process.env.SOCKET_IO_REDIS_ADAPTER === 'true' ||
    (IS_PRODUCTION && process.env.SOCKET_IO_REDIS_ADAPTER !== 'false')

  if (!enabled) {
    logger.info('Socket.IO Redis adapter disabled')
    return
  }

  try {
    const pubClient = createClient({ url: REDIS_URL })
    const subClient = pubClient.duplicate()

    pubClient.on('error', (err) =>
      logger.error({ err }, 'Socket.IO Redis pubClient error')
    )
    subClient.on('error', (err) =>
      logger.error({ err }, 'Socket.IO Redis subClient error')
    )

    await pubClient.connect()
    await subClient.connect()

    io.adapter(createAdapter(pubClient, subClient))
    logger.info({ redisUrl: REDIS_URL }, 'Socket.IO Redis adapter enabled')
  } catch (error) {
    logger.warn(
      { error, redisUrl: REDIS_URL },
      'Failed to enable Socket.IO Redis adapter; using in-memory adapter'
    )
  }
}

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true)
      if (origin === FRONTEND_URL) return cb(null, true)
      if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return cb(null, true)
      return cb(new Error('Not allowed by CORS'))
    },
    credentials: true,
  },
})

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {}

  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const [rawKey, ...rawVal] = part.trim().split('=')
    if (!rawKey) continue
    out[rawKey] = decodeURIComponent(rawVal.join('=') || '')
  }
  return out
}

io.use((socket, next) => {
  try {
    const cookieHeader = socket.request.headers.cookie
    const cookies = parseCookieHeader(cookieHeader)
    const token = cookies.token

    if (!token) return next(new Error('Unauthorized'))

    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload
    socket.data.userId = decoded.userId
    return next()
  } catch {
    return next(new Error('Unauthorized'))
  }
})

io.on('connection', (socket) => {
  const userId = socket.data.userId as string
  socket.join(`user:${userId}`)

  logger.info(
    { instanceId: INSTANCE_ID, socketId: socket.id, userId },
    'Socket connected (authed)'
  )

  socket.on('disconnect', (reason) => {
    logger.info(
      { instanceId: INSTANCE_ID, socketId: socket.id, userId, reason },
      'Socket disconnected'
    )
  })

  socket.emit('server:ready', { ok: true })
})

async function main() {
  await enableSocketIoRedisAdapter(io)
  initIO(io)

  httpServer.listen(PORT, () => {
    logger.info(`Server running at ${PORT}`)
    logger.info(
      `🌍 Environment: ${IS_PRODUCTION ? 'production' : 'development'}`
    )
    logger.info(`🛡️  CSRF protection: enabled`)
    logger.info(`🍪 Frontend URL: ${FRONTEND_URL}`)
    logger.info({ instanceId: INSTANCE_ID }, 'Server booted')
    startScheduledJobs()
  })
}

main().catch((err) => {
  logger.error({ error: err }, 'Server bootstrap failed')
  process.exit(1)
})
