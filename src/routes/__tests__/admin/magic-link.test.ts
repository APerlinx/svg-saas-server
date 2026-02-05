import request from 'supertest'
import jwt from 'jsonwebtoken'
import express from 'express'
import cookieParser from 'cookie-parser'
import * as emailService from '../../../services/emailService'

// Set environment before importing admin routes (must be before config/env loads)
process.env.ADMIN_EMAIL = 'admin@chatsvg.dev'
process.env.JWT_SECRET = 'test-secret-key-at-least-32-characters-long'

// Mock svgGenerationQueue (prevents Redis connection)
jest.mock('../../../jobs/svgGenerationQueue', () => ({
  svgGenerationQueue: {
    count: jest.fn().mockResolvedValue(0),
  },
}))

// Mock prisma (prevents database connection)
jest.mock('../../../lib/prisma', () => ({
  __esModule: true,
  default: {
    generationJob: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  },
}))

import adminRoutes from '../../admin.routes'

// Mock email service
jest.mock('../../../services/emailService')

// Mock logger
jest.mock('../../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('Admin Magic Link Authentication', () => {
  let app: express.Application

  beforeAll(() => {
    app = express()
    app.use(express.json())
    app.use(cookieParser())
    app.use('/api/admin', adminRoutes)
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('POST /api/admin/request-access', () => {
    it('should send magic link to admin email', async () => {
      ;(emailService.sendAdminMagicLink as jest.Mock).mockResolvedValue(
        undefined,
      )

      const response = await request(app)
        .post('/api/admin/request-access')
        .send({ email: 'admin@chatsvg.dev' })

      expect(response.status).toBe(200)
      expect(response.body.message).toBe('Magic link sent to your email')
      expect(emailService.sendAdminMagicLink).toHaveBeenCalledWith(
        'admin@chatsvg.dev',
        expect.any(String),
      )
    })

    it('should not reveal if email is incorrect', async () => {
      const response = await request(app)
        .post('/api/admin/request-access')
        .send({ email: 'wrong@example.com' })

      expect(response.status).toBe(200)
      expect(response.body.message).toBe(
        'If this email is registered as admin, a magic link was sent',
      )
      expect(emailService.sendAdminMagicLink).not.toHaveBeenCalled()
    })

    it('should require email field', async () => {
      const response = await request(app)
        .post('/api/admin/request-access')
        .send({})

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Email is required')
    })

    it('should handle email service errors', async () => {
      ;(emailService.sendAdminMagicLink as jest.Mock).mockRejectedValue(
        new Error('Email service down'),
      )

      const response = await request(app)
        .post('/api/admin/request-access')
        .send({ email: 'admin@chatsvg.dev' })

      expect(response.status).toBe(500)
      expect(response.body.error).toBe('Failed to send magic link')
    })
  })

  describe('GET /api/admin/auth', () => {
    it('should set admin session cookie and redirect with valid token', async () => {
      const token = jwt.sign(
        {
          email: 'admin@chatsvg.dev',
          type: 'admin_magic_link',
          nonce: '12345',
        },
        process.env.JWT_SECRET!,
        { expiresIn: '5m' },
      )

      const response = await request(app).get(`/api/admin/auth?token=${token}`)

      expect(response.status).toBe(302) // Redirect status
      expect(response.headers.location).toMatch(/\/admin$/) // Redirects to /admin

      const cookies = response.headers['set-cookie'] as unknown as string[]
      expect(cookies).toBeDefined()
      expect(cookies.some((c) => c.startsWith('admin_session='))).toBe(true)
    })

    it('should reject expired token', async () => {
      const token = jwt.sign(
        {
          email: 'admin@chatsvg.dev',
          type: 'admin_magic_link',
          nonce: '12345',
        },
        process.env.JWT_SECRET!,
        { expiresIn: '-1s' }, // Expired
      )

      const response = await request(app).get(`/api/admin/auth?token=${token}`)

      expect(response.status).toBe(401)
      expect(response.text).toContain('Invalid or expired magic link')
    })

    it('should reject token with wrong type', async () => {
      const token = jwt.sign(
        {
          email: 'admin@chatsvg.dev',
          type: 'wrong_type',
          nonce: '12345',
        },
        process.env.JWT_SECRET!,
        { expiresIn: '5m' },
      )

      const response = await request(app).get(`/api/admin/auth?token=${token}`)

      expect(response.status).toBe(403)
      expect(response.text).toContain('Invalid magic link')
    })

    it('should reject token with wrong email', async () => {
      const token = jwt.sign(
        {
          email: 'wrong@example.com',
          type: 'admin_magic_link',
          nonce: '12345',
        },
        process.env.JWT_SECRET!,
        { expiresIn: '5m' },
      )

      const response = await request(app).get(`/api/admin/auth?token=${token}`)

      expect(response.status).toBe(403)
      expect(response.text).toContain('Invalid magic link')
    })

    it('should require token parameter', async () => {
      const response = await request(app).get('/api/admin/auth')

      expect(response.status).toBe(400)
      expect(response.text).toContain('Invalid or missing token')
    })
  })

  describe('GET /api/admin/metrics', () => {
    it('should require admin authentication', async () => {
      const response = await request(app).get('/api/admin/metrics')

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Unauthorized')
    })

    it('should allow access with valid admin session', async () => {
      const sessionToken = jwt.sign(
        {
          email: 'admin@chatsvg.dev',
          type: 'admin',
        },
        process.env.JWT_SECRET!,
        { expiresIn: '24h' },
      )

      const response = await request(app)
        .get('/api/admin/metrics')
        .set('Cookie', [`admin_session=${sessionToken}`])

      expect(response.status).toBe(200)
      expect(response.body.ai).toBeDefined()
      expect(response.body.jobs).toBeDefined()
      expect(response.body.users).toBeDefined()
    })

    it('should reject expired admin session', async () => {
      const sessionToken = jwt.sign(
        {
          email: 'admin@chatsvg.dev',
          type: 'admin',
        },
        process.env.JWT_SECRET!,
        { expiresIn: '-1s' }, // Expired
      )

      const response = await request(app)
        .get('/api/admin/metrics')
        .set('Cookie', [`admin_session=${sessionToken}`])

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Unauthorized')
    })

    it('should reject session with wrong email', async () => {
      const sessionToken = jwt.sign(
        {
          email: 'wrong@example.com',
          type: 'admin',
        },
        process.env.JWT_SECRET!,
        { expiresIn: '24h' },
      )

      const response = await request(app)
        .get('/api/admin/metrics')
        .set('Cookie', [`admin_session=${sessionToken}`])

      expect(response.status).toBe(403)
      expect(response.body.error).toBe('Forbidden')
    })
  })

  describe('POST /api/admin/logout', () => {
    it('should clear admin session cookie', async () => {
      const response = await request(app).post('/api/admin/logout')

      expect(response.status).toBe(200)
      expect(response.body.message).toBe('Logged out successfully')

      const cookies = response.headers['set-cookie'] as unknown as string[]
      expect(cookies).toBeDefined()
      expect(
        cookies.some(
          (c) => c.includes('admin_session=') && c.includes('Expires'),
        ),
      ).toBe(true)
    })
  })
})
