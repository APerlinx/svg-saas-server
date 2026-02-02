// Mock BEFORE imports - mocks must be hoisted
jest.mock('../config/env', () => ({
  IS_TEST: false,
  IS_PRODUCTION: false,
}))

jest.mock('../lib/redis', () => ({
  redisClient: {
    isOpen: true,
    eval: jest.fn(),
  },
}))

jest.mock('../lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
}))

import { Request, Response } from 'express'
import { createRateLimiter } from './rateLimiter'
import { redisClient } from '../lib/redis'
import { logger } from '../lib/logger'
import * as Sentry from '@sentry/node'
import { IS_TEST } from '../config/env'

const mockedRedis = redisClient as unknown as {
  isOpen: boolean
  eval: jest.Mock
}
const mockedLogger = logger as unknown as {
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
