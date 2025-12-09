import request from 'supertest'
import express, { Request, Response } from 'express'
import router from '../../auth.routes'
import { clearAuthCookie } from '../../../utils/setAuthCookie'
import { revokeRefreshToken } from '../../../utils/refreshToken'
import cookieParser from 'cookie-parser'

// Mocks
jest.mock('../../../middleware/auth', () => ({
  authMiddleware: (req: Request, res: Response, next: Function) => next(),
}))
jest.mock('../../../utils/setAuthCookie', () => ({
  clearAuthCookie: jest.fn(),
}))
jest.mock('../../../utils/refreshToken', () => ({
  revokeRefreshToken: jest.fn(),
}))

const app = express()
app.use(express.json())
app.use(cookieParser())
app.use('/api/auth', router)

describe('POST /logout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should revoke refresh token and clear cookies if refresh token is present', async () => {
    ;(revokeRefreshToken as jest.Mock).mockResolvedValue(undefined)
    ;(clearAuthCookie as jest.Mock).mockImplementation(() => {})

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'refreshToken=testtoken')
      .send()

    expect(revokeRefreshToken).toHaveBeenCalledWith('testtoken')
    expect(clearAuthCookie).toHaveBeenCalled()
    expect(res.body).toEqual({ message: 'Logged out successfully' })
    expect(res.status).toBe(200)
  })

  it('should clear cookies even if no refresh token is present', async () => {
    const res = await request(app).post('/api/auth/logout').send()

    expect(revokeRefreshToken).not.toHaveBeenCalled()
    expect(clearAuthCookie).toHaveBeenCalled()
    expect(res.body).toEqual({ message: 'Logged out successfully' })
    expect(res.status).toBe(200)
  })

  it('should clear cookies and respond even if revokeRefreshToken throws', async () => {
    ;(revokeRefreshToken as jest.Mock).mockRejectedValue(new Error('DB error'))
    ;(clearAuthCookie as jest.Mock).mockImplementation(() => {})

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'refreshToken=testtoken')
      .send()

    expect(revokeRefreshToken).toHaveBeenCalledWith('testtoken')
    expect(clearAuthCookie).toHaveBeenCalled()
    expect(res.body).toEqual({ message: 'Logged out successfully' })
    expect(res.status).toBe(200)
  })
})
