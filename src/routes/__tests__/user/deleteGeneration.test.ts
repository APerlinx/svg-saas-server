jest.mock('../../../lib/prisma', () => ({
  __esModule: true,
  default: {
    svgGeneration: {
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}))

jest.mock('../../../middleware/auth', () => ({
  authMiddleware: jest.fn((req, res, next) => {
    req.user = { userId: 'user-123' }
    next()
  }),
}))

jest.mock('../../../lib/s3', () => ({
  deleteSvg: jest.fn(),
}))

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}))

jest.mock('../../../config/env', () => ({
  IS_PRODUCTION: true,
  IS_S3_ENABLED: true,
  PUBLIC_ASSETS_BASE_URL: 'https://cdn.example.com',
}))

import request from 'supertest'
import express from 'express'
import prisma from '../../../lib/prisma'
import { deleteSvg } from '../../../lib/s3'
import * as Sentry from '@sentry/node'

let app: express.Express

beforeAll(async () => {
  const routerModule = await import('../../user.routes.js')
  const router = routerModule.default as unknown as express.Router

  app = express()
  app.use(express.json())
  app.use('/api/user', router)
})

describe('DELETE /api/user/generations/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.SENTRY_DSN = 'test-dsn'
  })

  afterEach(() => {
    delete process.env.SENTRY_DSN
  })

  it('deletes DB first, then deletes from S3', async () => {
    ;(prisma.svgGeneration.findFirst as jest.Mock).mockResolvedValue({
      s3Key: 'k.svg',
    })
    ;(prisma.svgGeneration.deleteMany as jest.Mock).mockResolvedValue({
      count: 1,
    })
    ;(deleteSvg as jest.Mock).mockResolvedValue(undefined)

    const res = await request(app).delete('/api/user/generations/gen_1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })

    expect(prisma.svgGeneration.findFirst).toHaveBeenCalledWith({
      where: { id: 'gen_1', userId: 'user-123' },
      select: { s3Key: true },
    })

    expect(prisma.svgGeneration.deleteMany).toHaveBeenCalledWith({
      where: { id: 'gen_1', userId: 'user-123' },
    })

    expect(deleteSvg).toHaveBeenCalledWith('k.svg')

    const findOrder = (prisma.svgGeneration.findFirst as jest.Mock).mock
      .invocationCallOrder[0]
    const deleteDbOrder = (prisma.svgGeneration.deleteMany as jest.Mock).mock
      .invocationCallOrder[0]
    const deleteS3Order = (deleteSvg as jest.Mock).mock.invocationCallOrder[0]

    expect(findOrder).toBeLessThan(deleteDbOrder)
    expect(deleteDbOrder).toBeLessThan(deleteS3Order)
  })

  it('returns 404 if generation not found (no DB delete, no S3 delete)', async () => {
    ;(prisma.svgGeneration.findFirst as jest.Mock).mockResolvedValue(null)

    const res = await request(app).delete('/api/user/generations/missing')

    expect(res.status).toBe(404)
    expect(prisma.svgGeneration.deleteMany).not.toHaveBeenCalled()
    expect(deleteSvg).not.toHaveBeenCalled()
  })

  it('returns 404 if deleteMany count is 0 and reports to Sentry', async () => {
    ;(prisma.svgGeneration.findFirst as jest.Mock).mockResolvedValue({
      s3Key: 'k.svg',
    })
    ;(prisma.svgGeneration.deleteMany as jest.Mock).mockResolvedValue({
      count: 0,
    })

    const res = await request(app).delete('/api/user/generations/gen_1')

    expect(res.status).toBe(404)
    expect(deleteSvg).not.toHaveBeenCalled()
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1)
  })

  it('succeeds even if S3 delete fails, and reports to Sentry', async () => {
    ;(prisma.svgGeneration.findFirst as jest.Mock).mockResolvedValue({
      s3Key: 'k.svg',
    })
    ;(prisma.svgGeneration.deleteMany as jest.Mock).mockResolvedValue({
      count: 1,
    })
    ;(deleteSvg as jest.Mock).mockRejectedValue(new Error('S3 down'))

    const res = await request(app).delete('/api/user/generations/gen_1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })
})
