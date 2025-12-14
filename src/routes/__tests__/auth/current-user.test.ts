import request from 'supertest'
import express, { Request, Response } from 'express'
import router from '../../auth.routes'
import prisma from '../../../lib/prisma'
import { authMiddleware } from '../../../middleware/auth'
import { requireUserId } from '../../../utils/getUserId'

// Mock dependencies
jest.mock('../../../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
    },
  },
}))
jest.mock('../../../middleware/auth', () => ({
  authMiddleware: jest.fn((req: Request, res: Response, next: Function) =>
    next()
  ),
}))
jest.mock('../../../utils/getUserId', () => ({
  requireUserId: jest.fn(),
}))

const app = express()
app.use(express.json())
app.use('/api/auth', router)

describe('GET /current-user', () => {
  const mockUser = {
    id: 'user123',
    name: 'Test User',
    email: 'test@example.com',
    avatar: 'avatar.png',
    credits: 42,
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 401 if userId is not present', async () => {
    ;(requireUserId as jest.Mock).mockReturnValue(null)
    const res = await request(app).get('/api/auth/current-user')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
  })

  it('should return 404 if user not found', async () => {
    ;(requireUserId as jest.Mock).mockReturnValue('user123')
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)
    const res = await request(app).get('/api/auth/current-user')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'User not found' })
  })

  it('should return user data if user is found', async () => {
    ;(requireUserId as jest.Mock).mockReturnValue('user123')
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)
    const res = await request(app).get('/api/auth/current-user')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      id: mockUser.id,
      name: mockUser.name,
      email: mockUser.email,
      avatar: mockUser.avatar,
      credits: mockUser.credits,
    })
  })

  it('should default credits to 0 if undefined', async () => {
    ;(requireUserId as jest.Mock).mockReturnValue('user123')
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...mockUser,
      credits: undefined,
    })
    const res = await request(app).get('/api/auth/current-user')
    expect(res.status).toBe(200)
    expect(res.body.credits).toBe(0)
  })
})
