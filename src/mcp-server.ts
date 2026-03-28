import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import express from 'express'
import { oauthAuth } from './middleware/oauthAuth'
import { processUserCreditRefill } from './services/creditRefillService'
import {
  createGenerationJob,
  enqueueGenerationJob,
  ValidationError,
  ConflictError,
} from './services/svgGenerationService'
import prisma from './lib/prisma'
import { GenerationJobStatus } from '@prisma/client'
import { SvgStyle, VALID_SVG_STYLES } from './constants/svgStyles'
import { logger } from './lib/logger'
import { createPlanRateLimiter } from './middleware/rateLimiter'
import { incrementGenerationQuota } from './middleware/monthlyGenerationQuota'
import { logApiUsage } from './services/usageTrackingService'
import helmet from 'helmet'

export const sessions = new Map<string, StreamableHTTPServerTransport>()

function createMcpServer({ userId, apiKeyId }: { userId: string; apiKeyId?: string }) {
  const server = new McpServer({ name: 'svg-saas', version: '1.0.0' })

  server.registerTool(
    'generate_svg',
    {
      description: 'Generate an SVG from a text prompt',
      inputSchema: {
        prompt: z.string().describe('The text prompt to generate the SVG from'),
        style: z
          .string()
          .describe(
            'The style of the SVG, e.g. "line art", "isometric", "flat design", etc.',
          ),
      },
    },
    async ({ prompt, style }) => {
      const startedAt = Date.now()
      try {
        await processUserCreditRefill(userId)
        const result = await createGenerationJob({
          userId,
          prompt,
          style: style as SvgStyle,
          source: 'MCP',
          idempotencyKey: crypto.randomUUID(),
        })

        // Charge credits
        const charged = await prisma.$transaction(async (tx) => {
          const debit = await tx.user.updateMany({
            where: { id: userId, credits: { gt: 0 } },
            data: { credits: { decrement: 1 } },
          })
          if (debit.count === 0) return false
          await tx.generationJob.update({
            where: { id: result.job.id },
            data: { creditsCharged: true },
          })
          return true
        })

        if (!charged) {
          if (apiKeyId) {
            logApiUsage({
              apiKeyId,
              userId,
              endpoint: '/mcp/generate_svg',
              method: 'POST',
              statusCode: 402,
              latencyMs: Date.now() - startedAt,
              creditsUsed: 0,
            }).catch(() => {})
          }
          return {
            content: [{ type: 'text', text: 'Error: Insufficient credits' }],
          }
        }

        try {
          await enqueueGenerationJob(result.job.id, userId)
          await incrementGenerationQuota(userId)
          if (apiKeyId) {
            logApiUsage({
              apiKeyId,
              userId,
              endpoint: '/mcp/generate_svg',
              method: 'POST',
              statusCode: 200,
              latencyMs: Date.now() - startedAt,
              creditsUsed: 1,
            }).catch(() => {})
          }
        } catch (enqueueError) {
          await prisma.$transaction(async (tx) => {
            const refundClaim = await tx.generationJob.updateMany({
              where: {
                id: result.job.id,
                status: GenerationJobStatus.QUEUED,
                creditsCharged: true,
                creditsRefunded: false,
                generationId: null,
              },
              data: {
                status: GenerationJobStatus.FAILED,
                errorCode: 'ENQUEUE_FAILED',
                errorMessage: 'Failed to enqueue job.',
                creditsRefunded: true,
                finishedAt: new Date(),
                lastFailedAt: new Date(),
              },
            })
            if (refundClaim.count > 0) {
              await tx.user.update({
                where: { id: userId },
                data: { credits: { increment: 1 } },
              })
            }
          })
          throw enqueueError
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ jobId: result.job.id, status: 'queued' }),
            },
          ],
        }
      } catch (error) {
        if (
          error instanceof ValidationError ||
          error instanceof ConflictError
        ) {
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
          }
        }
        throw error
      }
    },
  )
  server.registerTool(
    'get_job_status',
    {
      description: 'Get the status of a long-running job',
      inputSchema: {
        jobId: z.string().describe('The job ID returned by generate_svg'),
      },
    },
    async ({ jobId }) => {
      const job = await prisma.generationJob.findUnique({
        where: { id: jobId, userId },
        select: {
          status: true,
          errorMessage: true,
          generation: { select: { svg: true } },
        },
      })
      if (!job) {
        return {
          content: [{ type: 'text', text: `Error: Job not found` }],
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: job.status,
              errorMessage: job.errorMessage ?? null,
              svg: job.generation?.svg ?? null,
            }),
          },
        ],
      }
    },
  )
  server.registerTool(
    'list_styles',
    {
      description:
        'List all available SVG styles that can be used with generate_svg',
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ styles: VALID_SVG_STYLES }),
        },
      ],
    }),
  )

  return server
}

export const app = express()
app.use(helmet())
app.use(express.json({ type: '*/*' }))

app.get('/mcp/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'mcp' })
})

app.post('/mcp', oauthAuth, createPlanRateLimiter(), async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string

  if (sessionId) {
    const transport = sessions.get(sessionId)
    if (!transport) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const isNotification =
      req.body &&
      req.body.jsonrpc === '2.0' &&
      req.body.id === undefined &&
      req.body.method
    if (isNotification) {
      logger.debug({ method: req.body.method }, 'MCP notification received')
      res.status(202).send()
      return
    }

    try {
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      logger.error({ error }, 'Error handling MCP request')
      res.status(500).json({ error: 'Internal server error' })
    }
    return
  }

  // New session — extract user context set by oauthAuth
  const userId = (req.user as any).id
  const apiKeyId = (req.user as any).apiKeyId as string | undefined
  const newSessionId = crypto.randomUUID()
  const server = createMcpServer({ userId, apiKeyId })
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => newSessionId,
  })
  transport.onclose = () => sessions.delete(newSessionId)
  await server.connect(transport)
  sessions.set(newSessionId, transport)
  logger.info(`New MCP session created: ${newSessionId}`)

  try {
    await transport.handleRequest(req, res, req.body)
  } catch (error) {
    logger.error({ error }, 'Error handling MCP request')
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/mcp', oauthAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string
  if (!sessionId) {
    res.status(400).send('Missing MCP-Session-Id header')
    return
  }
  const transport = sessions.get(sessionId)
  if (!transport) {
    res.status(404).send('Session not found')
    return
  }
  try {
    await transport.handleRequest(req, res)
  } catch (error) {
    logger.error({ error }, 'Error handling MCP request')
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.delete('/mcp', oauthAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string
  if (!sessionId) {
    res.status(400).send('Missing MCP-Session-Id header')
    return
  }
  const transport = sessions.get(sessionId)
  if (transport) {
    try {
      await transport.close()
    } catch (error) {
      logger.error({ error }, 'Error closing MCP session')
    }
  }
  res.status(200).send('Session closed')
})

if (require.main === module) {
  const PORT = process.env.MCP_PORT || 3001
  app.listen(PORT, () => {
    logger.info(`MCP Server is running on port ${PORT}`)
  })
}
