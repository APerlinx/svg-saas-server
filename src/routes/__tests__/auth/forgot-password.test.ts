import request from 'supertest'
import express from 'express'
import router from '../../auth.routes'
import prisma from '../../../lib/prisma'
import { sendPasswordResetEmail } from '../../../services/emailService'

jest.mock('../../../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}))

jest.mock('../../../services/emailService', () => ({
  sendPasswordResetEmail: jest.fn(),
}))

jest.mock('../../../middleware/rateLimiter', () => ({
  authLimiter: (req: any, res: any, next: any) => next(),
  forgotPasswordLimiter: (req: any, res: any, next: any) => next(),
}))

jest.mock('../../../utils/sanitizeInput', () => ({
  sanitizeInput: (input: string) => input,
}))

jest.mock('../../../utils/createPasswordResetToken', () => ({
  createPasswordResetToken: jest.fn(() => ({
    resetToken: 'mockToken',
    hashedToken: 'mockHashedToken',
    resetExpires: new Date(),
  })),
  hashResetToken: jest.fn(),
}))

const app = express()
app.use(express.json())
app.use('/api/auth', router)

describe('POST /forgot-password', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 400 if email is missing', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Email is required')
  })

  it('should return 400 if email format is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'invalid-email' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid email format')
  })

  it('should return 400 if email is too long', async () => {
    const longEmail = 'a'.repeat(250) + '@example.com'
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: longEmail })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Email is too long (max 254 characters)')
  })

  it('should return 200 even if user not found (security)', async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'notfound@example.com' })
    expect(res.status).toBe(200)
    expect(res.body.message).toContain('If that email is registered')
  })

  it('should send reset email for valid user', async () => {
    const mockUser = { id: '123', email: 'test@example.com' }
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)
    ;(prisma.user.update as jest.Mock).mockResolvedValue(mockUser)
    ;(sendPasswordResetEmail as jest.Mock).mockResolvedValue(undefined)

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com' })

    expect(res.status).toBe(200)
    expect(prisma.user.update).toHaveBeenCalled()
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      'test@example.com',
      'mockToken'
    )
  })
})
