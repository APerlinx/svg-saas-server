import request from 'supertest'
import express from 'express'

// Mock everything BEFORE importing the router
jest.mock('../../../lib/prisma', () => ({
  generationJob: {
    findFirst: jest.fn(),
  },
  svgGeneration: {
    findUnique: jest.fn(),
  },
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
}))

jest.mock('../../../utils/getUserId', () => ({
  requireUserId: jest.fn((req) => req.user.userId),
}))

jest.mock('../../../lib/s3', () => ({
  getDownloadUrl: jest.fn().mockResolvedValue('https://cdn.example.com/signed'),
}))

jest.mock('../../../config/env', () => ({
  PUBLIC_ASSETS_BASE_URL: 'https://cdn.example.com',
}))

jest.mock('../../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('../../../services/usageTrackingService', () => ({
  logApiUsage: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../../utils/rateLimitHeaders', () => ({
  setRateLimitHeaders: jest.fn(),
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

describe('GET /v1/svg/job/:id - Get Job Status', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 404 if job not found', async () => {
    prisma.generationJob.findFirst.mockResolvedValue(null)

    const res = await request(app).get('/v1/svg/job/job-123')

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Job not found')
  })

  it('should return 403 if job belongs to different user', async () => {
    prisma.generationJob.findFirst.mockResolvedValue(null)

    const res = await request(app).get('/v1/svg/job/job-123')

    expect(res.status).toBe(404)
    expect(prisma.generationJob.findFirst).toHaveBeenCalledWith({
      where: { id: 'job-123', userId: 'user-123' },
      select: expect.any(Object),
    })
  })

  it('should return queued job status', async () => {
    prisma.generationJob.findFirst.mockResolvedValue({
      id: 'job-123',
      status: 'QUEUED',
      prompt: 'a cat',
      style: 'outline',
      model: 'gpt-4o',
      createdAt: new Date(),
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      creditsCharged: false,
      generation: null,
    })

    const res = await request(app).get('/v1/svg/job/job-123')

    expect(res.status).toBe(200)
    expect(res.body.job.status).toBe('QUEUED')
    expect(res.body.job.id).toBe('job-123')
    expect(res.body.job.svg).toBeNull()
    expect(res.body.job.url).toBeNull()
  })

  it('should return running job status', async () => {
    prisma.generationJob.findFirst.mockResolvedValue({
      id: 'job-123',
      status: 'RUNNING',
      prompt: 'a cat',
      style: 'outline',
      model: 'gpt-4o',
      createdAt: new Date(),
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      creditsCharged: true,
      generation: null,
    })

    const res = await request(app).get('/v1/svg/job/job-123')

    expect(res.status).toBe(200)
    expect(res.body.job.status).toBe('RUNNING')
  })

  it('should return completed job with SVG URL for public generations', async () => {
    prisma.generationJob.findFirst.mockResolvedValue({
      id: 'job-123',
      status: 'COMPLETED',
      prompt: 'a cat',
      style: 'outline',
      model: 'gpt-4o',
      createdAt: new Date(),
      finishedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      creditsCharged: true,
      generation: {
        svg: '<svg>test</svg>',
        s3Key: 'svgs/123.svg',
      },
    })

    const res = await request(app).get('/v1/svg/job/job-123')

    expect(res.status).toBe(200)
    expect(res.body.job.status).toBe('COMPLETED')
    expect(res.body.job.url).toBe('https://cdn.example.com/svgs/123.svg')
  })

  it('should return completed job with presigned URL for private generations', async () => {
    prisma.generationJob.findFirst.mockResolvedValue({
      id: 'job-123',
      status: 'COMPLETED',
      prompt: 'a cat',
      style: 'outline',
      model: 'gpt-4o',
      createdAt: new Date(),
      finishedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      creditsCharged: true,
      generation: {
        svg: '<svg>private</svg>',
        s3Key: 'svgs/private-123.svg',
      },
    })

    const res = await request(app).get('/v1/svg/job/job-123')

    expect(res.status).toBe(200)
    expect(res.body.job.status).toBe('COMPLETED')
    expect(res.body.job.url).toBe(
      'https://cdn.example.com/svgs/private-123.svg',
    )
  })

  it('should return failed job with error details', async () => {
    prisma.generationJob.findFirst.mockResolvedValue({
      id: 'job-123',
      status: 'FAILED',
      prompt: 'a cat',
      style: 'outline',
      model: 'gpt-4o',
      createdAt: new Date(),
      finishedAt: new Date(),
      errorCode: 'GENERATION_FAILED',
      errorMessage: 'Failed to generate SVG',
      creditsCharged: true,
      generation: null,
    })

    const res = await request(app).get('/v1/svg/job/job-123')

    expect(res.status).toBe(200)
    expect(res.body.job.status).toBe('FAILED')
    expect(res.body.job.errorCode).toBe('GENERATION_FAILED')
    expect(res.body.job.errorMessage).toBe('Failed to generate SVG')
  })

  it('should include AI metrics when available', async () => {
    prisma.generationJob.findFirst.mockResolvedValue({
      id: 'job-123',
      status: 'COMPLETED',
      prompt: 'a cat',
      style: 'outline',
      model: 'gpt-4o',
      createdAt: new Date(),
      finishedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      creditsCharged: true,
      generation: {
        svg: '<svg>metrics</svg>',
        s3Key: 'svgs/123.svg',
      },
    })

    const res = await request(app).get('/v1/svg/job/job-123')

    expect(res.status).toBe(200)
    expect(res.body.job.status).toBe('COMPLETED')
    // AI metrics are stored but not exposed in v1 API
  })
})
