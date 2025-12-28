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
}))

import request from 'supertest'
import express from 'express'
import prisma from '../../../lib/prisma'
import { cache } from '../../../lib/cache'

let app: express.Express

beforeAll(async () => {
  const routerModule = await import('../../svg.routes')
  const router = routerModule.default

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
      totalCount: 2,
      totalPages: 1,
      hasMore: false,
      page: 1,
      limit: 10,
    }

    ;(cache.getOrSetJson as jest.Mock).mockResolvedValue(cachedData)

    const res = await request(app).get('/api/svg/public')

    expect(res.status).toBe(200)
    expect(res.body.publicGenerations).toHaveLength(2)
    expect(res.body.publicGenerations[0].prompt).toBe('A beautiful sunset')
    expect(res.body.pagination).toEqual({
      currentPage: 1,
      totalPages: 1,
      totalCount: 2,
      limit: 10,
      hasMore: false,
    })
    expect(cache.buildKey).toHaveBeenCalledWith(
      'public',
      'page',
      1,
      'limit',
      10
    )
    expect(cache.getOrSetJson).toHaveBeenCalled()
  })

  it('should handle pagination parameters', async () => {
    const cachedData = {
      publicGenerations: [],
      totalCount: 25,
      totalPages: 3,
      hasMore: true,
      page: 2,
      limit: 10,
    }

    ;(cache.getOrSetJson as jest.Mock).mockResolvedValue(cachedData)

    const res = await request(app).get('/api/svg/public?page=2&limit=10')

    expect(res.status).toBe(200)
    expect(res.body.pagination.currentPage).toBe(2)
    expect(res.body.pagination.totalPages).toBe(3)
    expect(res.body.pagination.hasMore).toBe(true)
    expect(cache.buildKey).toHaveBeenCalledWith(
      'public',
      'page',
      2,
      'limit',
      10
    )
  })

  it('should fetch from database when cache misses', async () => {
    const mockPublicGenerations = [
      {
        id: 'svg1',
        prompt: 'A test prompt',
        style: 'flat',
        model: 'gpt-4o',
        privacy: false,
        creditsUsed: 5,
        createdAt: new Date('2025-12-26T10:00:00Z'),
      },
    ]

    // Mock cache to call the fetcher function (simulating cache miss)
    ;(cache.getOrSetJson as jest.Mock).mockImplementation(
      async (key, fetcher) => {
        return await fetcher()
      }
    )
    ;(prisma.svgGeneration.count as jest.Mock).mockResolvedValue(1)
    ;(prisma.svgGeneration.findMany as jest.Mock).mockResolvedValue(
      mockPublicGenerations
    )

    const res = await request(app).get('/api/svg/public')

    expect(res.status).toBe(200)
    expect(res.body.publicGenerations).toHaveLength(1)
    expect(prisma.svgGeneration.count).toHaveBeenCalledWith({
      where: { privacy: false },
    })
    expect(prisma.svgGeneration.findMany).toHaveBeenCalledWith({
      where: { privacy: false },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 10,
      select: expect.any(Object),
    })
  })

  it('should return empty array when no public SVGs exist', async () => {
    const cachedData = {
      publicGenerations: [],
      totalCount: 0,
      totalPages: 0,
      hasMore: false,
      page: 1,
      limit: 10,
    }

    ;(cache.getOrSetJson as jest.Mock).mockResolvedValue(cachedData)

    const res = await request(app).get('/api/svg/public')

    expect(res.status).toBe(200)
    expect(res.body.publicGenerations).toEqual([])
    expect(res.body.pagination.totalCount).toBe(0)
  })

  it('should return 500 on database error', async () => {
    ;(cache.getOrSetJson as jest.Mock).mockRejectedValue(
      new Error('Database error')
    )

    const res = await request(app).get('/api/svg/public')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
  })

  it('should use default pagination values when not provided', async () => {
    const cachedData = {
      publicGenerations: [],
      totalCount: 0,
      totalPages: 0,
      hasMore: false,
      page: 1,
      limit: 10,
    }

    ;(cache.getOrSetJson as jest.Mock).mockResolvedValue(cachedData)

    const res = await request(app).get('/api/svg/public')

    expect(res.status).toBe(200)
    expect(cache.buildKey).toHaveBeenCalledWith(
      'public',
      'page',
      1,
      'limit',
      10
    )
  })
})
