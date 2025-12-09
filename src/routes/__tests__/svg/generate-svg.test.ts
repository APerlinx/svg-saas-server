import request from 'supertest'
import express from 'express'
import router from '../../svg.routes'
import prisma from '../../../lib/prisma'
import { generateSvg } from '../../../services/aiService'
import { VALID_SVG_STYLES } from '../../../constants/svgStyles'
import { DEFAULT_MODEL } from '../../../constants/models'
import { authMiddleware } from '../../../middleware/auth'

jest.mock('../../../lib/prisma')
jest.mock('../../../services/aiService', () => ({
  generateSvg: jest.fn(),
}))
jest.mock('../../../middleware/auth', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    req.user = { id: 'user1' }
    next()
  },
  optionalAuthMiddleware: (req: any, res: any, next: any) => next(),
  checkCoinsMiddleware: (req: any, res: any, next: any) => next(),
  svgGenerationLimiter: (req: any, res: any, next: any) => next(),
  dailyGenerationLimit: () => (req: any, res: any, next: any) => next(),
}))
jest.mock('../../../utils/getUserId', () => ({
  requireUserId: (req: any) => req.user.id,
  getUserId: (req: any) => req.user?.id,
}))
jest.mock('../../../utils/sanitizeInput', () => ({
  sanitizeInput: (input: string) => input,
}))
jest.mock('../../../utils/sanitizeSvg', () => ({
  sanitizeSvg: (svg: string) => svg,
}))

const app = express()
app.use(express.json())
app.use('/svg', router)

describe('POST /svg/generate-svg', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return 400 if prompt is missing', async () => {
    const res = await request(app)
      .post('/svg/generate-svg')
      .send({ style: VALID_SVG_STYLES[0] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Prompt is required/)
  })

  it('should return 400 if prompt is too short', async () => {
    const res = await request(app)
      .post('/svg/generate-svg')
      .send({ prompt: 'short', style: VALID_SVG_STYLES[0] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Prompt length must be between/)
  })

  it('should return 400 if prompt contains forbidden content', async () => {
    const res = await request(app)
      .post('/svg/generate-svg')
      .send({ prompt: '<script>alert(1)</script>', style: VALID_SVG_STYLES[0] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/forbidden content/)
  })

  it('should return 400 if style is invalid', async () => {
    const res = await request(app)
      .post('/svg/generate-svg')
      .send({ prompt: 'A valid prompt for SVG', style: 'invalid-style' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid style/)
  })

  it('should return 400 if model is invalid', async () => {
    const res = await request(app).post('/svg/generate-svg').send({
      prompt: 'A valid prompt for SVG',
      style: VALID_SVG_STYLES[0],
      model: 'invalid-model',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid model/)
  })

  it('should generate SVG and return 201 with svgCode', async () => {
    ;(generateSvg as jest.Mock).mockResolvedValue('<svg>test</svg>')
    ;(prisma.$transaction as jest.Mock).mockResolvedValue([{}, {}])

    const res = await request(app).post('/svg/generate-svg').send({
      prompt: 'A valid prompt for SVG generation',
      style: VALID_SVG_STYLES[0],
    })

    expect(res.status).toBe(201)
    expect(res.body.svgCode).toBe('<svg>test</svg>')
    expect(generateSvg).toHaveBeenCalledWith(
      'A valid prompt for SVG generation',
      VALID_SVG_STYLES[0],
      DEFAULT_MODEL
    )
    expect(prisma.$transaction).toHaveBeenCalled()
  })

  it('should handle internal server error', async () => {
    ;(generateSvg as jest.Mock).mockRejectedValue(new Error('AI error'))

    const res = await request(app).post('/svg/generate-svg').send({
      prompt: 'A valid prompt for SVG generation',
      style: VALID_SVG_STYLES[0],
    })

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/Internal server error/)
  })
})
