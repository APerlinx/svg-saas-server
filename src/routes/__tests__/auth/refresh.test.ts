import request from 'supertest'
import express from 'express'
import router from '../../auth.routes'
import jwt from 'jsonwebtoken'
import cookieParser from 'cookie-parser'
const {
  verifyRefreshToken,
  rotateRefreshToken,
} = require('../../../utils/refreshToken')
const {
  setAccessTokenCookie,
  setRefreshTokenCookie,
  clearAuthCookie,
} = require('../../../utils/setAuthCookie')

jest.mock('../../../utils/refreshToken', () => ({
  verifyRefreshToken: jest.fn(),
  rotateRefreshToken: jest.fn(),
}))
jest.mock('../../../utils/setAuthCookie', () => ({
  setAccessTokenCookie: jest.fn(),
  setRefreshTokenCookie: jest.fn(),
  clearAuthCookie: jest.fn(),
}))
jest.mock('../../../utils/getUserIp', () => ({
  getUserIp: jest.fn(() => '127.0.0.1'),
}))

const app = express()
app.use(express.json())
app.use(cookieParser())
app.use('/api/auth', router)

const JWT_SECRET = 'testsecret'
const ACCESS_TOKEN_EXPIRY = '15m'
const REFRESH_TOKEN_EXPIRY_DAYS = 7

describe('POST /refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.JWT_SECRET = JWT_SECRET
  })

  it('should return 401 if no refresh token is provided', async () => {
    const res = await request(app).post('/api/auth/refresh')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'No refresh token provided' })
  })

  it('should return 401 if refresh token is invalid', async () => {
    verifyRefreshToken.mockResolvedValue(null)
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=invalidtoken'])
      .send()
    expect(clearAuthCookie).toHaveBeenCalled()
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Invalid or expired refresh token' })
  })

  it('should return 401 if token rotation fails', async () => {
    verifyRefreshToken.mockResolvedValue('user123')
    rotateRefreshToken.mockResolvedValue(null)
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=validtoken'])
      .send()
    expect(clearAuthCookie).toHaveBeenCalled()
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Token rotation failed' })
  })

  it('should refresh tokens and return success', async () => {
    verifyRefreshToken.mockResolvedValue('user123')
    rotateRefreshToken.mockResolvedValue('newRefreshToken')
    setAccessTokenCookie.mockImplementation(() => {})
    setRefreshTokenCookie.mockImplementation(() => {})
    jwt.sign = jest.fn(() => 'newAccessToken')

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=validtoken'])
      .send()
    expect(setAccessTokenCookie).toHaveBeenCalledWith(
      expect.anything(),
      'newAccessToken'
    )
    expect(setRefreshTokenCookie).toHaveBeenCalledWith(
      expect.anything(),
      'newRefreshToken',
      false
    )
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Token refreshed successfully' })
  })

  it('should handle internal server error', async () => {
    verifyRefreshToken.mockImplementation(() => {
      throw new Error('fail')
    })
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=validtoken'])
      .send()
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
  })
})
