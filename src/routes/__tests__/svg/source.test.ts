jest.mock('../../../lib/prisma', () => ({
  __esModule: true,
  default: {
    svgGeneration: {
      findUnique: jest.fn(),
    },
  },
}))

jest.mock('../../../middleware/auth', () => ({
  authMiddleware: jest.fn((req, res, next) => next()),
  optionalAuthMiddleware: jest.fn((req, res, next) => next()),
}))

jest.mock('../../../lib/s3', () => ({
  __esModule: true,
  getDownloadUrl: jest.fn(),
  getSvgSourceFromS3: jest.fn(),
}))

jest.mock('../../../jobs/svgGenerationQueue', () => ({
  __esModule: true,
  enqueueSvgGenerationJob: jest.fn(),
  svgGenerationQueue: {
    getJobCounts: jest.fn(),
  },
}))

import request from 'supertest'
import express from 'express'
import prisma from '../../../lib/prisma'
import { getSvgSourceFromS3 } from '../../../lib/s3'

let app: express.Express

beforeAll(async () => {
  const routerModule = await import('../../svg.routes.js')
  const router = routerModule.default as unknown as express.Router

  app = express()
  app.use(express.json())
  app.use('/api/svg', router)
})

describe('GET /:id/source', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return SVG source from S3 when s3Key exists', async () => {
    ;(prisma.svgGeneration.findUnique as jest.Mock).mockResolvedValue({
      id: 'g1',
      userId: 'u1',
      privacy: false,
      s3Key: 'users/u1/jobs/j1/chatsvg.svg',
      svg: null,
    })
    ;(getSvgSourceFromS3 as jest.Mock).mockResolvedValue('<svg>from-s3</svg>')

    const res = await request(app).get('/api/svg/g1/source')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'g1', svg: '<svg>from-s3</svg>' })
    expect(getSvgSourceFromS3).toHaveBeenCalledWith(
      'users/u1/jobs/j1/chatsvg.svg',
    )
  })

  it('should fall back to DB svg when no s3Key', async () => {
    ;(prisma.svgGeneration.findUnique as jest.Mock).mockResolvedValue({
      id: 'g2',
      userId: 'u2',
      privacy: false,
      s3Key: null,
      svg: '<svg>from-db</svg>',
    })

    const res = await request(app).get('/api/svg/g2/source')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'g2', svg: '<svg>from-db</svg>' })
    expect(getSvgSourceFromS3).not.toHaveBeenCalled()
  })

  it('should return 403 for private SVG when not owner', async () => {
    ;(prisma.svgGeneration.findUnique as jest.Mock).mockResolvedValue({
      id: 'g3',
      userId: 'u-owner',
      privacy: true,
      s3Key: 'k',
      svg: null,
    })

    const res = await request(app).get('/api/svg/g3/source')

    expect(res.status).toBe(403)
    expect(getSvgSourceFromS3).not.toHaveBeenCalled()
  })

  it('should return 404 when not found', async () => {
    ;(prisma.svgGeneration.findUnique as jest.Mock).mockResolvedValue(null)

    const res = await request(app).get('/api/svg/missing/source')

    expect(res.status).toBe(404)
  })

  it('should return svg=null when no source is available', async () => {
    ;(prisma.svgGeneration.findUnique as jest.Mock).mockResolvedValue({
      id: 'g4',
      userId: 'u4',
      privacy: false,
      s3Key: null,
      svg: null,
    })

    const res = await request(app).get('/api/svg/g4/source')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'g4', svg: null })
    expect(getSvgSourceFromS3).not.toHaveBeenCalled()
  })
})
