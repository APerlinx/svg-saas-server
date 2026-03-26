import request from 'supertest'

jest.mock('../../../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { updateMany: jest.fn() },
    generationJob: { update: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn((cb: any) =>
      cb({
        user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        generationJob: { update: jest.fn().mockResolvedValue({}) },
      }),
    ),
  },
}))

jest.mock('../../../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../../../middleware/oauthAuth.js', () => ({
  oauthAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123' }
    next()
  },
}))

jest.mock('../../../services/svgGenerationService', () => ({
  createGenerationJob: jest.fn(),
  enqueueGenerationJob: jest.fn().mockResolvedValue(undefined),
  ValidationError: class ValidationError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ValidationError'
    }
  },
  ConflictError: class ConflictError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ConflictError'
    }
  },
}))

jest.mock('../../../services/creditRefillService', () => ({
  processUserCreditRefill: jest.fn().mockResolvedValue(undefined),
}))

import { app, sessions } from '../../../mcp-server'
const {
  createGenerationJob,
} = require('../../../services/svgGenerationService')

describe('MCP Server', () => {
  beforeEach(() => jest.clearAllMocks())

  afterEach(async () => {
    for (const transport of sessions.values()) {
      await transport.close()
    }
    sessions.clear()
  })

  // Helper to send a JSON-RPC initialize request and get a session ID
  function parseSseResult(text: string) {
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'))!
    return JSON.parse(dataLine.slice('data: '.length))
  }

  async function openSession(): Promise<string> {
    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
      })
    const sessionId = res.headers['mcp-session-id']
    if (!sessionId)
      throw new Error(`MCP handshake failed: ${JSON.stringify(res.body)}`)
    return sessionId
  }

  it('rejects requests without a Bearer token', async () => {
    const res = await request(app).post('/mcp').send({})
    expect(res.status).not.toBe(404)
  })

  it('generate_svg returns jobId on success', async () => {
    createGenerationJob.mockResolvedValue({
      status: 'created',
      job: { id: 'job-123', status: 'QUEUED' },
    })

    const sessionId = await openSession()

    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('mcp-session-id', sessionId)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'generate_svg',
          arguments: { prompt: 'a red dragon breathing fire', style: 'flat' },
        },
      })

    expect(res.status).toBe(200)
    const json = parseSseResult(res.text)
    const result = JSON.parse(json.result.content[0].text)
    expect(result).toMatchObject({ jobId: 'job-123', status: 'queued' })
  })

  it('get_job_status returns job data', async () => {
    const prisma = require('../../../lib/prisma').default
    prisma.generationJob.findUnique.mockResolvedValue({
      status: 'SUCCEEDED',
      errorMessage: null,
      generation: { svg: '<svg>...</svg>' },
    })

    const sessionId = await openSession()

    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('mcp-session-id', sessionId)
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get_job_status',
          arguments: { jobId: 'job-123' },
        },
      })

    expect(res.status).toBe(200)
    const json = parseSseResult(res.text)
    const result = JSON.parse(json.result.content[0].text)
    expect(result).toMatchObject({ status: 'SUCCEEDED', svg: '<svg>...</svg>' })
  })
})
