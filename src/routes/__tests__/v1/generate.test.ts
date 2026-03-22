import request from 'supertest'
import express from 'express'

// Mock everything BEFORE importing the router
jest.mock('../../../lib/prisma', () => ({
  user: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  generationJob: {
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
}))

jest.mock('../../../middleware/apiKeyAuth', () => ({
  apiKeyAuth: (req: any, res: any, next: any) => {
    req.user = { userId: 'user-123' }
    req.apiKey = {
      id: 'key-123',
      userId: 'user-123',
      plan: 'SUPPORTER',
    }
    next()
  },
}))

jest.mock('../../../middleware/monthlyGenerationQuota', () => ({
  monthlyGenerationQuota: () => (req: any, res: any, next: any) => next(),
  incrementGenerationQuota: jest.fn(),
}))

jest.mock('../../../middleware/rateLimiter', () => ({
  createPlanRateLimiter: () => (req: any, res: any, next: any) => next(),
}))

jest.mock('../../../services/creditRefillService', () => ({
  processUserCreditRefill: jest.fn().mockResolvedValue(100), // Return credit balance
}))

jest.mock('../../../utils/getUserId', () => ({
  requireUserId: jest.fn((req) => req.user.userId),
}))

jest.mock('../../../services/svgGenerationService', () => ({
  createGenerationJob: jest.fn(),
  enqueueGenerationJob: jest.fn(),
  ValidationError: class ValidationError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ValidationError'
    }
  },
}))

jest.mock('../../../services/usageTrackingService', () => ({
  logApiUsage: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../../utils/rateLimitHeaders', () => ({
  setRateLimitHeaders: jest.fn(),
}))

jest.mock('../../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('../../../config/env', () => ({
  PUBLIC_ASSETS_BASE_URL: 'https://cdn.example.com',
}))

jest.mock('../../../lib/bullmq', () => ({
  createBullMqConnection: jest.fn(() => ({
    on: jest.fn(),
    quit: jest.fn(),
  })),
}))

// Import router AFTER mocks are set up
const router = require('../../v1.routes').default
const prisma = require('../../../lib/prisma')

const app = express()
app.use(express.json())
app.use('/v1', router)

describe('POST /v1/svg/generate - Generate SVG', () => {
  const {
    createGenerationJob,
    enqueueGenerationJob,
  } = require('../../../services/svgGenerationService')
  const {
    incrementGenerationQuota,
  } = require('../../../middleware/monthlyGenerationQuota')

  beforeEach(() => {
    jest.clearAllMocks()
    // Setup default transaction mock
    prisma.$transaction.mockImplementation(async (callback: any) => {
      return callback(prisma)
    })
  })

  it('should return 400 if request body is invalid', async () => {
    const res = await request(app).post('/v1/svg/generate').send('invalid')

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid request body')
  })

  it('should return 400 if prompt is missing', async () => {
    const {
      ValidationError,
    } = require('../../../services/svgGenerationService')
    createGenerationJob.mockRejectedValue(
      new ValidationError('Prompt is required'),
    )

    const res = await request(app)
      .post('/v1/svg/generate')
      .send({ style: 'outline' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Prompt is required')
  })

  it('should handle duplicate requests correctly', async () => {
    createGenerationJob.mockResolvedValue({
      status: 'duplicate',
      job: {
        id: 'job-123',
        status: 'COMPLETED',
      },
    })

    const res = await request(app)
      .post('/v1/svg/generate')
      .send({ prompt: 'test', idempotencyKey: 'key-123' })

    expect(res.status).toBe(200)
    expect(res.body.duplicate).toBe(true)
    expect(res.body.creditsCharged).toBe(false)
    expect(res.body.jobId).toBe('job-123')
  })

  it('should return 402 if user has insufficient credits', async () => {
    createGenerationJob.mockResolvedValue({
      status: 'created',
      job: {
        id: 'job-123',
        status: 'QUEUED',
      },
    })

    prisma.user.updateMany.mockResolvedValue({ count: 0 })

    const res = await request(app)
      .post('/v1/svg/generate')
      .send({ prompt: 'test' })

    expect(res.status).toBe(402)
    expect(res.body.error).toBe('Insufficient credits')
  })

  it('should create generation job and charge credits successfully', async () => {
    createGenerationJob.mockResolvedValue({
      status: 'created',
      job: {
        id: 'job-123',
        status: 'QUEUED',
      },
    })

    prisma.user.updateMany.mockResolvedValue({ count: 1 })
    prisma.generationJob.update.mockResolvedValue({})
    enqueueGenerationJob.mockResolvedValue(undefined)
    incrementGenerationQuota.mockResolvedValue(undefined)

    const res = await request(app)
      .post('/v1/svg/generate')
      .send({ prompt: 'a cat', style: 'outline', model: 'gpt-4o' })

    expect(res.status).toBe(202)
    expect(res.body.jobId).toBe('job-123')
    expect(res.body.status).toBe('queued')
    expect(res.body.creditsCharged).toBe(true)
    expect(enqueueGenerationJob).toHaveBeenCalledWith('job-123', 'user-123')
  })

  it('should refund credits if enqueue fails', async () => {
    createGenerationJob.mockResolvedValue({
      status: 'created',
      job: {
        id: 'job-123',
        status: 'QUEUED',
      },
    })

    prisma.user.updateMany.mockResolvedValue({ count: 1 })
    prisma.generationJob.update.mockResolvedValue({})
    prisma.generationJob.updateMany.mockResolvedValue({ count: 1 })
    prisma.user.update.mockResolvedValue({})
    enqueueGenerationJob.mockRejectedValue(new Error('Queue error'))

    const res = await request(app)
      .post('/v1/svg/generate')
      .send({ prompt: 'test' })

    expect(res.status).toBe(500)
    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creditsRefunded: true,
        }),
      }),
    )
  })

  it('should pass API key ID to job creation', async () => {
    createGenerationJob.mockResolvedValue({
      status: 'created',
      job: {
        id: 'job-123',
        status: 'QUEUED',
      },
    })

    prisma.user.updateMany.mockResolvedValue({ count: 1 })
    prisma.generationJob.update.mockResolvedValue({})
    enqueueGenerationJob.mockResolvedValue(undefined)

    await request(app).post('/v1/svg/generate').send({ prompt: 'test' })

    expect(createGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'API',
        apiKeyId: 'key-123',
      }),
    )
  })
})
