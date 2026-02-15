import request from 'supertest'
import express from 'express'
import router from '../../apiKeys.routes'
import { requireUserId } from '../../../utils/getUserId'
const prisma = require('../../../lib/prisma')

// Mocks
jest.mock('../../../lib/prisma', () => ({
  user: {
    findUnique: jest.fn(),
  },
  apiKey: {
    count: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
}))

jest.mock('../../../middleware/auth', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    req.user = { userId: 'user-123' }
    next()
  },
}))

jest.mock('../../../utils/getUserId', () => ({
  requireUserId: jest.fn((req) => req.user.userId),
}))

jest.mock('../../../services/apiKeyService', () => ({
  createApiKey: jest.fn(),
  getUserApiKeys: jest.fn(),
  revokeApiKey: jest.fn(),
  getApiKeyUsageStats: jest.fn(),
}))

jest.mock('../../../services/usageTrackingService', () => ({
  getUserUsageSummary: jest.fn(),
}))

jest.mock('../../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}))

const app = express()
app.use(express.json())
app.use('/api/keys', router)

describe('POST /api/keys - Create API Key', () => {
  const { createApiKey } = require('../../../services/apiKeyService')

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 400 if name is missing', async () => {
    const res = await request(app).post('/api/keys').send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Name is required')
  })

  it('should return 400 if name is empty string', async () => {
    const res = await request(app).post('/api/keys').send({ name: '   ' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Name is required')
  })

  it('should return 400 if name is too long', async () => {
    const res = await request(app)
      .post('/api/keys')
      .send({ name: 'a'.repeat(101) })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Name must be 100 characters or less')
  })

  it('should return 403 if user does not have API access', async () => {
    createApiKey.mockRejectedValue(
      new Error('API access requires PRO or ENTERPRISE plan'),
    )

    const res = await request(app).post('/api/keys').send({ name: 'Test Key' })

    expect(res.status).toBe(403)
    expect(res.body.error).toContain('API access requires')
  })

  it('should return 400 if user exceeded maximum API keys', async () => {
    createApiKey.mockRejectedValue(
      new Error('Maximum API keys reached for your plan'),
    )

    const res = await request(app).post('/api/keys').send({ name: 'Test Key' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Maximum API keys')
  })

  it('should create API key successfully', async () => {
    const mockApiKey = {
      id: 'key-123',
      name: 'Test Key',
      keyPrefix: 'sk_test_abc',
      rawKey: 'sk_test_abcdefghijklmnopqrstuvwxyz123456',
      createdAt: new Date(),
    }

    createApiKey.mockResolvedValue(mockApiKey)

    const res = await request(app).post('/api/keys').send({ name: 'Test Key' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBe('key-123')
    expect(res.body.name).toBe('Test Key')
    expect(res.body.keyPrefix).toBe('sk_test_abc')
    expect(res.body.key).toBe('sk_test_abcdefghijklmnopqrstuvwxyz123456')
    expect(res.body.warning).toContain('Save this key now')
  })

  it('should trim name before creating API key', async () => {
    const mockApiKey = {
      id: 'key-123',
      name: 'Test Key',
      keyPrefix: 'sk_test_abc',
      rawKey: 'sk_test_abcdefghijklmnopqrstuvwxyz123456',
      createdAt: new Date(),
    }

    createApiKey.mockResolvedValue(mockApiKey)

    await request(app).post('/api/keys').send({ name: '  Test Key  ' })

    expect(createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Key',
      }),
    )
  })

  it('should accept optional environment parameter', async () => {
    const mockApiKey = {
      id: 'key-123',
      name: 'Test Key',
      keyPrefix: 'sk_test_abc',
      rawKey: 'sk_test_abcdefghijklmnopqrstuvwxyz123456',
      createdAt: new Date(),
    }

    createApiKey.mockResolvedValue(mockApiKey)

    await request(app)
      .post('/api/keys')
      .send({ name: 'Test Key', environment: 'test' })

    expect(createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'test',
      }),
    )
  })

  it('should default environment to production if invalid', async () => {
    const mockApiKey = {
      id: 'key-123',
      name: 'Test Key',
      keyPrefix: 'sk_prod_abc',
      rawKey: 'sk_prod_abcdefghijklmnopqrstuvwxyz123456',
      createdAt: new Date(),
    }

    createApiKey.mockResolvedValue(mockApiKey)

    await request(app)
      .post('/api/keys')
      .send({ name: 'Test Key', environment: 'invalid' })

    expect(createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'production',
      }),
    )
  })
})
