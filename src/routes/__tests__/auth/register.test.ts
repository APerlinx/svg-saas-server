import request from 'supertest'
import express, { Express } from 'express'
import router from '../../auth.routes'
import prisma from '../../../lib/prisma'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { sendWelcomeEmail } from '../../../services/emailService'
import { createRefreshToken } from '../../../utils/refreshToken'
import { getUserIp } from '../../../utils/getUserIp'
import { sanitizeInput } from '../../../utils/sanitizeInput'

jest.mock('../../../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}))

jest.mock('bcrypt')
jest.mock('jsonwebtoken')
jest.mock('../../../services/emailService')
jest.mock('../../../utils/refreshToken')
jest.mock('../../../utils/getUserIp')
jest.mock('../../../utils/sanitizeInput')
jest.mock('../../../utils/setAuthCookie')
jest.mock('../../../middleware/rateLimiter', () => ({
  authLimiter: (req: any, res: any, next: any) => next(),
  forgotPasswordLimiter: (req: any, res: any, next: any) => next(),
}))

describe('POST /register', () => {
  let app: Express

  beforeEach(() => {
    app = express()
    app.use(express.json())
    app.use('/api/auth', router)
    jest.clearAllMocks()
    ;(sanitizeInput as jest.Mock).mockImplementation((val) => val)
    ;(getUserIp as jest.Mock).mockReturnValue('127.0.0.1')
  })

  it('should register a new user successfully', async () => {
    const mockUser = {
      id: '123',
      email: 'test@example.com',
      name: 'Test User',
      credits: 10,
      avatar: null,
      passwordHash: 'hashed',
    }

    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)
    ;(bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword')
    ;(prisma.user.create as jest.Mock).mockResolvedValue(mockUser)
    ;(jwt.sign as jest.Mock).mockReturnValue('accessToken')
    ;(createRefreshToken as jest.Mock).mockResolvedValue('refreshToken')
    ;(sendWelcomeEmail as jest.Mock).mockResolvedValue(undefined)

    const response = await request(app).post('/api/auth/register').send({
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
      agreedToTerms: true,
    })

    expect(response.status).toBe(201)
    expect(response.body.user).toEqual({
      id: '123',
      email: 'test@example.com',
      name: 'Test User',
      credits: 10,
      avatar: null,
    })
    expect(sendWelcomeEmail).toHaveBeenCalledWith(
      'test@example.com',
      'Test User'
    )
  })

  it('should return 400 if required fields are missing', async () => {
    const response = await request(app).post('/api/auth/register').send({
      email: 'test@example.com',
      password: 'password123',
    })

    expect(response.status).toBe(400)
  })

  it('should return 400 if email format is invalid', async () => {
    const response = await request(app).post('/api/auth/register').send({
      email: 'invalid-email',
      password: 'password123',
      name: 'Test User',
      agreedToTerms: true,
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Invalid email format')
  })

  it('should return 400 if password is less than 8 characters', async () => {
    const response = await request(app).post('/api/auth/register').send({
      email: 'test@example.com',
      password: 'pass',
      name: 'Test User',
      agreedToTerms: true,
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Password must be at least 8 characters')
  })

  it('should return 400 if email is too long', async () => {
    const longEmail = 'a'.repeat(250) + '@example.com' // Over 254 chars
    const response = await request(app).post('/api/auth/register').send({
      email: longEmail,
      password: 'password123',
      name: 'Test User',
      agreedToTerms: true,
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Email is too long (max 254 characters)')
  })

  it('should return 400 if password is too long', async () => {
    const longPassword = 'a'.repeat(130) // Over 128 chars
    const response = await request(app).post('/api/auth/register').send({
      email: 'test@example.com',
      password: longPassword,
      name: 'Test User',
      agreedToTerms: true,
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe(
      'Password is too long (max 128 characters)'
    )
  })

  it('should return 400 if name is too long', async () => {
    const longName = 'a'.repeat(101) // Over 100 chars
    const response = await request(app).post('/api/auth/register').send({
      email: 'test@example.com',
      password: 'password123',
      name: longName,
      agreedToTerms: true,
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Name is too long (max 100 characters)')
  })

  it('should return 400 if terms are not agreed', async () => {
    const response = await request(app).post('/api/auth/register').send({
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
      agreedToTerms: false,
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('Terms of Service')
  })

  it('should return 400 if email already exists', async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: '123',
      email: 'test@example.com',
    })

    const response = await request(app).post('/api/auth/register').send({
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
      agreedToTerms: true,
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Email is invalid or already taken')
  })

  it('should return 500 if an error occurs', async () => {
    ;(prisma.user.findUnique as jest.Mock).mockRejectedValue(
      new Error('Database error')
    )

    const response = await request(app).post('/api/auth/register').send({
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
      agreedToTerms: true,
    })

    expect(response.status).toBe(500)
    expect(response.body.error).toBe('Internal server error')
  })

  it('should sanitize and lowercase email', async () => {
    ;(sanitizeInput as jest.Mock).mockImplementation((val) => val.trim())
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)
    ;(bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword')
    ;(prisma.user.create as jest.Mock).mockResolvedValue({
      id: '123',
      email: 'test@example.com',
      name: 'Test User',
      credits: 10,
    })
    ;(jwt.sign as jest.Mock).mockReturnValue('token')
    ;(createRefreshToken as jest.Mock).mockResolvedValue('refreshToken')
    ;(sendWelcomeEmail as jest.Mock).mockResolvedValue(undefined)

    await request(app).post('/api/auth/register').send({
      email: '  TEST@EXAMPLE.COM  ',
      password: 'password123',
      name: '  Test User  ',
      agreedToTerms: true,
    })

    expect(sanitizeInput).toHaveBeenCalledWith('  test@example.com  ')
    expect(sanitizeInput).toHaveBeenCalledWith('  Test User  ')
  })
})
