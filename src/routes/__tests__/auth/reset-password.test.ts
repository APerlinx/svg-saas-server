import request from 'supertest'
import express from 'express'
import router from '../../auth.routes'
import prisma from '../../../lib/prisma'
import bcrypt from 'bcrypt'
import { hashResetToken } from '../../../utils/createPasswordResetToken'

jest.mock('../../../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}))

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}))

jest.mock('../../../middleware/rateLimiter', () => ({
  authLimiter: (req: any, res: any, next: any) => next(),
  forgotPasswordLimiter: (req: any, res: any, next: any) => next(),
}))

jest.mock('../../../utils/sanitizeInput', () => ({
  sanitizeInput: (input: string) => input,
}))

jest.mock('../../../utils/createPasswordResetToken', () => ({
  hashResetToken: jest.fn((token: string) => `hashed_${token}`),
}))

jest.mock('../../../utils/refreshToken', () => ({
  revokeAllUserTokens: jest.fn(),
}))

const app = express()
app.use(express.json())
app.use('/api/auth', router)

describe('POST /reset-password', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 400 if password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'someToken' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Missing required fields')
  })

  it('should return 400 if password is too short', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'someToken', newPassword: 'short' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Password must be at least 8 characters')
  })

  it('should return 400 if password is too long', async () => {
    const longPassword = 'a'.repeat(130)
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'someToken', newPassword: longPassword })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Password is too long (max 128 characters)')
  })

  it('should return 400 if token is invalid or expired', async () => {
    ;(prisma.user.findFirst as jest.Mock).mockResolvedValue(null)

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'invalidToken', newPassword: 'ValidPassword123' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid or expired reset token')
  })

  it('should reset password successfully with valid token', async () => {
    const mockUser = {
      id: '123',
      email: 'test@example.com',
      resetPasswordToken: 'hashed_validToken',
      resetPasswordExpires: new Date(Date.now() + 3600000), // 1 hour from now
    }

    ;(prisma.user.findFirst as jest.Mock).mockResolvedValue(mockUser)
    ;(bcrypt.hash as jest.Mock).mockResolvedValue('hashedNewPassword')
    ;(prisma.user.update as jest.Mock).mockResolvedValue({
      ...mockUser,
      password: 'hashedNewPassword',
      resetPasswordToken: null,
      resetPasswordExpires: null,
    })

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'validToken', newPassword: 'NewPassword123' })

    expect(res.status).toBe(200)
    expect(res.body.message).toBe(
      'Password has been reset successfully. Please log in again.'
    )
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: '123' },
      data: {
        passwordHash: 'hashedNewPassword',
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    })
  })
})
