jest.mock('../../../lib/prisma', () => ({
  __esModule: true,
  default: {
    svgGeneration: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}))

jest.mock('../../../jobs/svgGenerationQueue', () => ({
  __esModule: true,
  enqueueSvgGenerationJob: jest.fn(),
  svgGenerationQueue: {
    getJobCounts: jest.fn(),
  },
}))

jest.mock('../../../lib/cache', () => ({
  cache: {
    getOrSetJson: jest.fn(),
    buildKey: jest.fn((...parts) => parts.join(':')),
    del: jest.fn(),
  },
}))

jest.mock('../../../utils/sanitizeSvg', () => ({
  sanitizeSvg: jest.fn((svg) => svg),
}))

jest.mock('../../../services/aiService', () => ({
  generateSvg: jest.fn(),
}))

jest.mock('../../../middleware/rateLimiter', () => ({
  svgGenerationLimiter: jest.fn((req, res, next) => next()),
  authLimiter: jest.fn((req, res, next) => next()),
  apiLimiter: jest.fn((req, res, next) => next()),
  forgotPasswordLimiter: jest.fn((req, res, next) => next()),
  downloadLimiter: jest.fn((req, res, next) => next()),
}))

import request from 'supertest'
import express from 'express'
import prisma from '../../../lib/prisma'
import { cache } from '../../../lib/cache'

let app: express.Express

beforeAll(async () => {
  const routerModule = await import('../../svg.routes.js')
  const router = routerModule.default as unknown as express.Router

  app = express()
  app.use(express.json())
  app.use('/api/svg', router)
})

describe('GET /public', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return paginated public SVGs from cache', async () => {
    const mockPublicGenerations = [
      {
        id: 'svg1',
        prompt: 'A beautiful sunset',
        style: 'flat',
        model: 'gpt-4o',
        privacy: false,
        creditsUsed: 5,
        createdAt: new Date('2025-12-26T10:00:00Z'),
      },
      {
        id: 'svg2',
        prompt: 'A cute cat',
        style: 'lineart',
        model: 'gpt-4o',
        privacy: false,
        creditsUsed: 5,
        createdAt: new Date('2025-12-26T09:00:00Z'),
      },
    ]

    const cachedData = {
      publicGenerations: mockPublicGenerations,
      nextCursor: null,
    }

    ;(cache.getOrSetJson as jest.Mock).mockResolvedValue(cachedData)

    const res = await request(app).get('/api/svg/public')

    expect(res.status).toBe(200)
    expect(res.body.publicGenerations).toHaveLength(2)
    expect(res.body.publicGenerations[0].prompt).toBe('A beautiful sunset')
    expect(cache.buildKey).toHaveBeenCalledWith(
      'public:v4:first',
      'style',
      'all',
      'model',
      'all',
      'limit',
      50,
    )
    expect(cache.getOrSetJson).toHaveBeenCalled()
  })

  it('should fetch from database when cache misses', async () => {
    const mockPublicGenerations = [
      {
        id: 'svg1',
        prompt: 'A test prompt',
        style: 'flat',
        model: 'gpt-4o',
        privacy: false,
        creditsUsed: 1,
        createdAt: new Date('2025-12-26T10:00:00Z'),
      },
    ]

    // Mock cache to call the fetcher function (simulating cache miss)
    ;(cache.getOrSetJson as jest.Mock).mockImplementation(
      async (key, fetcher) => {
        return await fetcher()
      },
    )
    ;(prisma.svgGeneration.count as jest.Mock).mockResolvedValue(1)
    ;(prisma.svgGeneration.findMany as jest.Mock).mockResolvedValue(
      mockPublicGenerations,
    )

    const res = await request(app).get('/api/svg/public')

    expect(res.status).toBe(200)
    expect(res.body.publicGenerations).toHaveLength(1)
    expect(prisma.svgGeneration.findMany).toHaveBeenCalledWith({
      where: { privacy: false },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      select: expect.any(Object),
    })
    expect(res.body.nextCursor).toBeNull()
  })

  it('should return empty array when no public SVGs exist', async () => {
    const cachedData = {
      publicGenerations: [],
      nextCursor: null,
    }

    ;(cache.getOrSetJson as jest.Mock).mockResolvedValue(cachedData)

    const res = await request(app).get('/api/svg/public')

    expect(res.status).toBe(200)
    expect(res.body.publicGenerations).toEqual([])
    expect(res.body.nextCursor).toBeNull()
  })

  it('should treat empty cursor as first page and use cache', async () => {
    const cachedData = {
      publicGenerations: [],
      nextCursor: null,
    }

    ;(cache.getOrSetJson as jest.Mock).mockResolvedValue(cachedData)

    const res = await request(app).get('/api/svg/public?cursor=')

    expect(res.status).toBe(200)
    expect(cache.buildKey).toHaveBeenCalledWith(
      'public:v4:first',
      'style',
      'all',
      'model',
      'all',
      'limit',
      50,
    )
    expect(cache.getOrSetJson).toHaveBeenCalled()
  })

  it('should return 400 for invalid style', async () => {
    const res = await request(app).get('/api/svg/public?style=not-a-style')

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid style/i)
    expect(cache.getOrSetJson).not.toHaveBeenCalled()
    expect(prisma.svgGeneration.findMany).not.toHaveBeenCalled()
  })

  it('should return 400 for invalid model', async () => {
    const res = await request(app).get('/api/svg/public?model=not-a-model')

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid model/i)
    expect(cache.getOrSetJson).not.toHaveBeenCalled()
    expect(prisma.svgGeneration.findMany).not.toHaveBeenCalled()
  })

  it('should return 500 on database error', async () => {
    ;(cache.getOrSetJson as jest.Mock).mockRejectedValue(
      new Error('Database error'),
    )

    const res = await request(app).get('/api/svg/public')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
  })

  it('should use default pagination values when not provided', async () => {
    const cachedData = {
      publicGenerations: [],
      nextCursor: null,
    }

    ;(cache.getOrSetJson as jest.Mock).mockResolvedValue(cachedData)

    const res = await request(app).get('/api/svg/public')

    expect(res.status).toBe(200)
    expect(cache.buildKey).toHaveBeenCalledWith(
      'public:v4:first',
      'style',
      'all',
      'model',
      'all',
      'limit',
      50,
    )
  })
})
