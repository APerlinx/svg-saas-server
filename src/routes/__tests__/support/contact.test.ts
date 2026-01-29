import request from 'supertest'
import express from 'express'
import router from '../../support.routes'
import {
  sendSupportMessageEmail,
  sendSupportConfirmationEmail,
} from '../../../services/emailService'

import prisma from '../../../lib/prisma'

jest.mock('../../../services/emailService', () => ({
  sendSupportMessageEmail: jest.fn(),
  sendSupportConfirmationEmail: jest.fn(),
}))

jest.mock('../../../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
    },
  },
}))

jest.mock('../../../middleware/rateLimiter', () => ({
  supportMessageLimiter: (req: any, res: any, next: any) => next(),
}))

jest.mock('../../../middleware/auth', () => ({
  optionalAuthMiddleware: (req: any, res: any, next: any) => {
    const userId = req.get('x-test-user-id')
    if (userId) req.user = { userId }
    next()
  },
}))

jest.mock('../../../utils/sanitizeInput', () => ({
  sanitizeInput: (input: string) => input.trim(),
}))

jest.mock('../../../utils/getUserIp', () => ({
  getUserIp: () => '1.2.3.4',
}))

const app = express()
app.use(express.json())
app.use('/api/support', router)

describe('POST /api/support/contact', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 400 for invalid type', async () => {
    const res = await request(app).post('/api/support/contact').send({
      type: 'other',
      subject: 'Hello',
      message: 'World',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid support message type')
  })

  it('returns 400 when subject/message missing', async () => {
    const res = await request(app).post('/api/support/contact').send({
      type: 'contact',
      subject: '',
      message: '',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Subject and message are required')
  })

  it('returns 400 when logged out and email is missing', async () => {
    const res = await request(app).post('/api/support/contact').send({
      type: 'bug',
      subject: 'It broke',
      message: 'Steps to repro...',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Email is required when not logged in')
    expect(sendSupportMessageEmail).not.toHaveBeenCalled()
  })

  it('sends internal email and confirmation when logged out', async () => {
    ;(sendSupportMessageEmail as jest.Mock).mockResolvedValue(undefined)
    ;(sendSupportConfirmationEmail as jest.Mock).mockResolvedValue(undefined)

    const res = await request(app).post('/api/support/contact').send({
      type: 'bug',
      subject: 'It broke',
      message: 'Steps to repro...',
      email: 'test@example.com',
    })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(sendSupportMessageEmail).toHaveBeenCalled()
    expect(sendSupportConfirmationEmail).toHaveBeenCalled()
  })

  it('uses DB email and still sends confirmation when logged in', async () => {
    ;(sendSupportMessageEmail as jest.Mock).mockResolvedValue(undefined)
    ;(sendSupportConfirmationEmail as jest.Mock).mockResolvedValue(undefined)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      email: 'authed@example.com',
    })

    const res = await request(app)
      .post('/api/support/contact')
      .set('x-test-user-id', 'user_123')
      .send({
        type: 'idea',
        subject: 'New feature',
        message: 'Please add ...',
      })

    expect(res.status).toBe(200)
    expect(sendSupportMessageEmail).toHaveBeenCalled()
    expect(sendSupportConfirmationEmail).toHaveBeenCalledWith(
      'authed@example.com',
      'idea',
      'New feature',
    )
  })
})
