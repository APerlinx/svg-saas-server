import request from 'supertest'
import express from 'express'
import router from '../../auth.routes'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
const prisma = require('../../../lib/prisma')

// Mocks
jest.mock('../../../lib/prisma', () => ({
  user: {
    findUnique: jest.fn(),
  },
}))
jest.mock('bcrypt')
jest.mock('jsonwebtoken')
jest.mock('../../../utils/getUserIp', () => ({
  getUserIp: jest.fn(() => '127.0.0.1'),
}))
jest.mock('../../../utils/setAuthCookie', () => ({
  setAccessTokenCookie: jest.fn(),
  setRefreshTokenCookie: jest.fn(),
}))
jest.mock('../../../utils/refreshToken', () => ({
  createRefreshToken: jest.fn(() => 'mockRefreshToken'),
}))
jest.mock('../../../utils/sanitizeInput', () => ({
  sanitizeInput: (input: string) => input,
}))
jest.mock('../../../middleware/rateLimiter', () => ({
  authLimiter: (req: any, res: any, next: any) => next(),
  forgotPasswordLimiter: (req: any, res: any, next: any) => next(),
}))

// Mock CSRF middleware
jest.mock('../../../middleware/csrf', () => ({
  validateCsrfToken: (req: any, res: any, next: any) => next(),
}))

const ACCESS_TOKEN_EXPIRY = '15m'
const JWT_SECRET = 'testsecret'
const REFRESH_TOKEN_EXPIRY_DAYS = 7

const app = express()
app.use(express.json())
// Use mocked CSRF middleware and mount router at /api/auth
const { validateCsrfToken } = require('../../../middleware/csrf')
app.use('/api/auth', validateCsrfToken, router)

describe('POST /login', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 400 if email is too long', async () => {
    const longEmail = 'a'.repeat(250) + '@example.com' // Over 254 chars
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: longEmail, password: 'password123' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Email is too long (max 254 characters)')
  })

  it('should return 400 if password is too long', async () => {
    const longPassword = 'a'.repeat(130) // Over 128 chars
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: longPassword })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Password is too long (max 128 characters)')
  })

  it('should return 400 if email format is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'invalid-email', password: 'password123' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid email format')
  })

  it('should return 401 if user not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null)
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid credentials')
  })

  it('should return 401 if password does not match', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'test@example.com',
      name: 'Test',
      avatar: null,
      plan: null,
      coins: 10,
      passwordHash: 'hashed',
    })
    ;(bcrypt.compare as jest.Mock).mockResolvedValue(false)
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpass' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid credentials')
  })

  it('should login and return user data, set cookies', async () => {
    const user = {
      id: 1,
      email: 'test@example.com',
      name: 'Test',
      avatar: null,
      plan: null,
      coins: 10,
      passwordHash: 'hashed',
    }
    prisma.user.findUnique.mockResolvedValue(user)
    ;(bcrypt.compare as jest.Mock).mockResolvedValue(true)
    ;(jwt.sign as jest.Mock).mockReturnValue('mockAccessToken')

    const res = await request(app).post('/api/auth/login').send({
      email: 'test@example.com',
      password: 'password123',
      rememberMe: false,
    })

    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      plan: user.plan,
      coins: user.coins,
    })
    expect(
      require('../../../utils/setAuthCookie').setAccessTokenCookie
    ).toHaveBeenCalledWith(expect.any(Object), 'mockAccessToken')
    expect(
      require('../../../utils/setAuthCookie').setRefreshTokenCookie
    ).toHaveBeenCalledWith(expect.any(Object), 'mockRefreshToken', false)
  })

  it('should use 30 days expiry if rememberMe is true', async () => {
    const user = {
      id: 2,
      email: 'remember@example.com',
      name: 'Remember',
      avatar: null,
      plan: null,
      coins: 5,
      passwordHash: 'hashed',
    }
    prisma.user.findUnique.mockResolvedValue(user)
    ;(bcrypt.compare as jest.Mock).mockResolvedValue(true)
    ;(jwt.sign as jest.Mock).mockReturnValue('mockAccessToken')

    await request(app).post('/api/auth/login').send({
      email: 'remember@example.com',
      password: 'password123',
      rememberMe: true,
    })

    expect(
      require('../../../utils/refreshToken').createRefreshToken
    ).toHaveBeenCalledWith(user.id, 30, '127.0.0.1', undefined)
    expect(
      require('../../../utils/setAuthCookie').setRefreshTokenCookie
    ).toHaveBeenCalledWith(expect.any(Object), 'mockRefreshToken', true)
  })

  it('should return 500 on unexpected error', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('DB error'))
    const res = await request(app).post('/api/auth/login').send({
      email: 'test@example.com',
      password: 'password123',
    })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
  })
})
