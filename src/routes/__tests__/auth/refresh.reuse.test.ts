import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import router from '../../auth.routes'

jest.mock('../../../utils/refreshToken', () => ({
  verifyAndRotateRefreshToken: jest.fn(),
}))

jest.mock('../../../utils/setAuthCookie', () => ({
  // we only need to assert clearAuthCookie was called
  clearAuthCookie: jest.fn(),
  // keep others as real or mock, doesn't matter for this test
  setAccessTokenCookie: jest.fn(),
  setRefreshTokenCookie: jest.fn(),
}))

const { verifyAndRotateRefreshToken } = require('../../../utils/refreshToken')
const { clearAuthCookie } = require('../../../utils/setAuthCookie')

const app = express()
app.use(express.json())
app.use(cookieParser())
app.use('/api/auth', router)

describe('POST /api/auth/refresh (reuse detection)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.JWT_SECRET = 'testsecret'
  })

  it('401 and clears cookies when refresh token reuse is detected', async () => {
    verifyAndRotateRefreshToken.mockResolvedValue({
      ok: false,
      reason: 'REUSED',
    })

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=revokedTokenUsedAgain'])
      .send()

    expect(res.status).toBe(401)
    expect(clearAuthCookie).toHaveBeenCalled()
  })
})
