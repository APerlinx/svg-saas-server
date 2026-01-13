jest.mock('../../../lib/prisma', () => ({
  __esModule: true,
  default: {
    generationJob: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))
jest.mock('../../../jobs/svgGenerationQueue', () => ({
  __esModule: true,
  enqueueSvgGenerationJob: jest.fn(),
  svgGenerationQueue: {
    getJobCounts: jest.fn(),
  },
}))
jest.mock('../../../middleware/auth', () => ({
  __esModule: true,
  authMiddleware: (req: any, res: any, next: any) => {
    req.user = { id: 'user1' }
    next()
  },
  optionalAuthMiddleware: (req: any, res: any, next: any) => next(),
  svgGenerationLimiter: (req: any, res: any, next: any) => next(),
  dailyGenerationLimit: () => (req: any, res: any, next: any) => next(),
}))
jest.mock('../../../utils/getUserId', () => ({
  __esModule: true,
  requireUserId: (req: any) => req.user.id,
  getUserId: (req: any) => req.user?.id,
}))

import request from 'supertest'
import express from 'express'
import prisma from '../../../lib/prisma'
import { VALID_SVG_STYLES } from '../../../constants/svgStyles'
import { DEFAULT_MODEL } from '../../../constants/models'
import { computeRequestHash } from '../../../utils/computeRequestHash'
import { authMiddleware } from '../../../middleware/auth'
import {
  enqueueSvgGenerationJob,
  svgGenerationQueue,
} from '../../../jobs/svgGenerationQueue'

let app: express.Express
const basePrompt = 'A valid prompt for SVG generation'
const baseStyle = VALID_SVG_STYLES[0]
const baseModel = DEFAULT_MODEL
const basePrivacy = false
const baseRequestHash = computeRequestHash({
  prompt: basePrompt,
  style: baseStyle,
  model: baseModel,
  privacy: basePrivacy,
})

const baseJob = {
  id: 'job-123',
  userId: 'user1',
  prompt: basePrompt,
  style: baseStyle,
  model: baseModel,
  privacy: basePrivacy,
  status: 'QUEUED',
  createdAt: new Date('2025-12-25T00:00:00.000Z'),
  startedAt: null,
  finishedAt: null,
  errorCode: null,
  errorMessage: null,
  generationId: null,
  generation: null,
  requestHash: baseRequestHash,
}

beforeAll(async () => {
  const routerModule = await import('../../svg.routes.js')
  const router = routerModule.default as unknown as express.Router

  app = express()
  app.use(express.json())
  app.use('/api/svg', router)
})

describe('POST /generate-svg', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Mock Prisma transaction wrapper used by the route.
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({
        user: {
          updateMany: prisma.user.updateMany,
          update: prisma.user.update,
        },
        generationJob: {
          update: prisma.generationJob.update,
          updateMany: prisma.generationJob.updateMany,
        },
      })
    )
    ;(svgGenerationQueue.getJobCounts as jest.Mock).mockResolvedValue({
      waiting: 0,
      delayed: 0,
      active: 0,
    })
    ;(prisma.generationJob.create as jest.Mock).mockResolvedValue({
      ...baseJob,
    })
    ;(prisma.generationJob.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user1' })

    // Default: user has credits available.
    ;(prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    ;(prisma.generationJob.update as jest.Mock).mockResolvedValue({
      ...baseJob,
      creditsCharged: true,
    })
    ;(prisma.generationJob.updateMany as jest.Mock).mockResolvedValue({
      count: 0,
    })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({ id: 'user1' })
  })

  it('should return 400 if prompt is missing', async () => {
    const res = await request(app)
      .post('/api/svg/generate-svg')
      .send({ style: VALID_SVG_STYLES[0] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Prompt is required/)
  })

  it('should return 400 if prompt is too short', async () => {
    const res = await request(app)
      .post('/api/svg/generate-svg')
      .send({ prompt: 'short', style: VALID_SVG_STYLES[0] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Prompt length must be between/)
  })

  it('should return 400 if prompt contains forbidden content', async () => {
    const res = await request(app)
      .post('/api/svg/generate-svg')
      .send({ prompt: '<script>alert(1)</script>', style: VALID_SVG_STYLES[0] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/forbidden content/)
  })

  it('should return 400 if style is invalid', async () => {
    const res = await request(app)
      .post('/api/svg/generate-svg')
      .send({ prompt: 'A valid prompt for SVG', style: 'invalid-style' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid style/)
  })

  it('should return 400 if model is invalid', async () => {
    const res = await request(app).post('/api/svg/generate-svg').send({
      prompt: 'A valid prompt for SVG',
      style: VALID_SVG_STYLES[0],
      model: 'invalid-model',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid model/)
  })

  it('should enqueue a generation job and return 202 with queue metadata', async () => {
    const res = await request(app)
      .post('/api/svg/generate-svg')
      .set('x-idempotency-key', 'key-123')
      .send({
        prompt: basePrompt,
        style: baseStyle,
      })

    expect(res.status).toBe(202)
    expect(res.body.job.id).toBe('job-123')
    expect(prisma.generationJob.create).toHaveBeenCalledWith({
      data: {
        userId: 'user1',
        prompt: basePrompt,
        style: baseStyle,
        model: baseModel,
        privacy: basePrivacy,
        idempotencyKey: 'key-123',
        requestHash: expect.any(String),
      },
      select: expect.objectContaining({
        id: true,
        userId: true,
        prompt: true,
        style: true,
        model: true,
        privacy: true,
        status: true,
        requestHash: true,
        generation: expect.objectContaining({
          select: expect.objectContaining({
            id: true,
            prompt: true,
            style: true,
            model: true,
            svg: true,
            privacy: true,
            createdAt: true,
          }),
        }),
      }),
    })
    expect(enqueueSvgGenerationJob).toHaveBeenCalledWith('job-123', 'user1')
    expect(svgGenerationQueue.getJobCounts).toHaveBeenCalled()
    expect(res.headers.location).toContain('/api/svg/generation-jobs/job-123')
  })

  it('should reuse an existing job when idempotency key matches', async () => {
    ;(prisma.generationJob.findFirst as jest.Mock).mockResolvedValue({
      ...baseJob,
      id: 'job-existing',
    })

    const res = await request(app)
      .post('/api/svg/generate-svg')
      .set('x-idempotency-key', '1234')
      .send({
        prompt: basePrompt,
        style: baseStyle,
      })

    expect(res.status).toBe(202)
    expect(res.body.job.id).toBe('job-existing')
    expect(prisma.generationJob.create).not.toHaveBeenCalled()
    expect(enqueueSvgGenerationJob).not.toHaveBeenCalled()
  })

  it('should reject overly long idempotency keys', async () => {
    const longKey = 'x'.repeat(129)
    const res = await request(app)
      .post('/api/svg/generate-svg')
      .set('x-idempotency-key', longKey)
      .send({
        prompt: 'A valid prompt for SVG generation',
        style: VALID_SVG_STYLES[0],
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Idempotency key/i)
    expect(prisma.generationJob.create).not.toHaveBeenCalled()
  })

  it('should handle internal server error', async () => {
    ;(prisma.generationJob.create as jest.Mock).mockRejectedValue(
      new Error('DB error')
    )

    const res = await request(app)
      .post('/api/svg/generate-svg')
      .set('x-idempotency-key', 'key-500')
      .send({
        prompt: 'A valid prompt for SVG generation',
        style: VALID_SVG_STYLES[0],
      })

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/Internal server error/)
  })

  it('should return 400 if idempotency key is missing', async () => {
    const res = await request(app).post('/api/svg/generate-svg').send({
      prompt: basePrompt,
      style: baseStyle,
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/idempotency/i)
    expect(prisma.generationJob.create).not.toHaveBeenCalled()
    expect(enqueueSvgGenerationJob).not.toHaveBeenCalled()
  })
})
