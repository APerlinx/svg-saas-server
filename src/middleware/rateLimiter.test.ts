// Mock BEFORE imports - mocks must be hoisted
jest.mock('../config/env', () => ({
  IS_TEST: false,
  IS_PRODUCTION: false,
}))

jest.mock('../lib/redis', () => ({
  redisClient: {
    isOpen: true,
    eval: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    get: jest.fn(),
  },
}))

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
    },
  },
}))

jest.mock('../lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
}))

import { Request, Response, NextFunction } from 'express'
import { createRateLimiter, createPlanRateLimiter } from './rateLimiter'
import { redisClient } from '../lib/redis'
import { logger } from '../lib/logger'
import prisma from '../lib/prisma'
import * as Sentry from '@sentry/node'
import { IS_TEST } from '../config/env'

const mockedRedis = redisClient as unknown as {
  isOpen: boolean
  eval: jest.Mock
  incr: jest.Mock
  expire: jest.Mock
  get: jest.Mock
}
const mockedLogger = logger as unknown as {
  debug: jest.Mock
  info: jest.Mock
  warn: jest.Mock
  error: jest.Mock
}
const mockedSentry = Sentry as jest.Mocked<typeof Sentry>

describe('rateLimiter middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedRedis.isOpen = true
    mockedSentry.captureMessage.mockClear()
  })

  it('IS_TEST should be mocked to false', () => {
    expect(IS_TEST).toBe(false)
  })

  const createLimiter = () =>
    createRateLimiter({
      windowMs: 60 * 1000,
      max: 5,
      message: 'Too many requests',
      keyPrefix: 'rl:test',
    })

  const buildResponse = () => {
    const res: Partial<Response> = {}
    res.setHeader = jest.fn()
    res.status = jest.fn().mockReturnValue(res)
    res.json = jest.fn().mockReturnValue(res)
    return res as Response & {
      setHeader: jest.Mock
      status: jest.Mock
      json: jest.Mock
    }
  }

  test('allows request when under limit', async () => {
    mockedRedis.eval.mockResolvedValue([3, 120])
    const limiter = createLimiter()
    const req = { ip: '1.1.1.1' } as Request
    const res = buildResponse()
    const next = jest.fn()

    await limiter(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '5')
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '3')
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Reset',
      expect.any(String),
    )
  })

  test('blocks request when limit exceeded', async () => {
    mockedRedis.eval.mockResolvedValue([0, 45])
    const limiter = createLimiter()
    const req = {
      ip: '2.2.2.2',
      path: '/test',
      method: 'GET',
      get: jest.fn(),
    } as unknown as Request
    const res = buildResponse()
    const next = jest.fn()

    await limiter(req, res, next)

    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.json).toHaveBeenCalledWith({ error: 'Too many requests' })
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '45')
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, ttl: 45 }),
      'Rate limit exceeded',
    )
    expect(next).not.toHaveBeenCalled()
  })

  test('skips limiting when redis is disconnected', async () => {
    mockedRedis.isOpen = false
    const limiter = createLimiter()
    const req = { ip: '3.3.3.3' } as Request
    const res = buildResponse()
    const next = jest.fn()

    await limiter(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(mockedRedis.eval).not.toHaveBeenCalled()
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'Redis not connected, skipping rate limit',
    )
  })

  test('fails open when redis throws', async () => {
    mockedRedis.eval.mockRejectedValue(new Error('redis down'))
    const limiter = createLimiter()
    const req = { ip: '4.4.4.4' } as Request
    const res = buildResponse()
    const next = jest.fn()

    await limiter(req, res, next)

    expect(mockedLogger.error).toHaveBeenCalledWith(
      { error: expect.any(Error) },
      'Rate limiter error, allowing request',
    )
    expect(next).toHaveBeenCalled()
  })
})

describe('Plan-Based Rate Limiter', () => {
  let req: Partial<Request>
  let res: ReturnType<typeof buildResponse>
  let next: jest.Mock

  const buildResponse = () => {
    const res: Partial<Response> = {}
    res.setHeader = jest.fn()
    res.status = jest.fn().mockReturnValue(res)
    res.json = jest.fn().mockReturnValue(res)
    return res as Response & {
      setHeader: jest.Mock
      status: jest.Mock
      json: jest.Mock
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockedRedis.isOpen = true

    req = {
      path: '/v1/svg/generate',
      method: 'POST',
      apiUser: { id: 'user-123', plan: 'FREE' },
    } as any

    res = buildResponse()
    next = jest.fn()
  })

  describe('FREE plan', () => {
    beforeEach(() => {
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        plan: 'FREE',
      })
    })

    test('allows requests within limit (20/hour)', async () => {
      mockedRedis.incr.mockResolvedValue(5)
      mockedRedis.expire.mockResolvedValue(true)

      const limiter = createPlanRateLimiter()
      await limiter(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '20')
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '15')
    })

    test('blocks requests exceeding limit', async () => {
      mockedRedis.incr.mockResolvedValue(21)

      const limiter = createPlanRateLimiter()
      await limiter(req as Request, res as Response, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(429)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Rate limit exceeded',
          message: expect.stringContaining('20 requests per hour'),
        }),
      )
    })

    test('sets expiry on first request', async () => {
      mockedRedis.incr.mockResolvedValue(1)
      mockedRedis.expire.mockResolvedValue(true)

      const limiter = createPlanRateLimiter()
      await limiter(req as Request, res as Response, next)

      expect(mockedRedis.expire).toHaveBeenCalledWith(
        expect.stringContaining('ratelimit:plan:user-123:'),
        3600,
      )
    })
  })

  describe('SUPPORTER plan', () => {
    beforeEach(() => {
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-456',
        plan: 'SUPPORTER',
      })
      req.apiUser = { id: 'user-456', plan: 'SUPPORTER' } as any
    })

    test('allows higher limits (60/hour)', async () => {
      mockedRedis.incr.mockResolvedValue(50)

      const limiter = createPlanRateLimiter()
      await limiter(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '60')
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '10')
    })

    test('blocks at 61st request', async () => {
      mockedRedis.incr.mockResolvedValue(61)

      const limiter = createPlanRateLimiter()
      await limiter(req as Request, res as Response, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(429)
    })
  })

  describe('authentication', () => {
    test('requires auth by default', async () => {
      req.apiUser = undefined
      req.user = undefined

      const limiter = createPlanRateLimiter()
      await limiter(req as Request, res as Response, next)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    test('skips check if skipAuth=true', async () => {
      req.apiUser = undefined
      req.user = undefined

      const limiter = createPlanRateLimiter({ skipAuth: true })
      await limiter(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
    })

    test('supports session auth', async () => {
      req.apiUser = undefined
      req.user = { id: 'user-123' } as any
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        plan: 'FREE',
      })
      mockedRedis.incr.mockResolvedValue(5)

      const limiter = createPlanRateLimiter()
      await limiter(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    test('fails open if Redis is down', async () => {
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        plan: 'FREE',
      })
      mockedRedis.incr.mockRejectedValue(new Error('Redis down'))

      const limiter = createPlanRateLimiter()
      await limiter(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })

    test('returns 404 if user not found', async () => {
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)

      const limiter = createPlanRateLimiter()
      await limiter(req as Request, res as Response, next)

      expect(res.status).toHaveBeenCalledWith(404)
    })

    test('skips if Redis not connected', async () => {
      mockedRedis.isOpen = false

      const limiter = createPlanRateLimiter()
      await limiter(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(mockedRedis.incr).not.toHaveBeenCalled()
    })
  })
})
