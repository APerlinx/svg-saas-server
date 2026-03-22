/// <reference path="./types/express.d.ts" />
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import express from 'express'
import { apiKeyAuth } from './middleware/apiKeyAuth'

const sessions = new Map<string, StreamableHTTPServerTransport>()

function createMcpServer() {
  const server = new McpServer({ name: 'svg-saas', version: '1.0.0' })

  server.registerTool(
    'generate-svg',
    {
      description: 'Generate an SVG from a text prompt',
      inputSchema: {
        prompt: z.string().describe('The text prompt to generate the SVG from'),
        style: z
          .string()
          .describe(
            'The style of the SVG, e.g. "line art", "isometric", "flat design", etc.',
          )
          .optional(),
      },
    },
    async ({ prompt, style }) => {
      return {
        content: [
          {
            type: 'text',
            text: `Generated SVG for prompt: ${prompt} with style: ${style || 'default'}`,
          },
        ],
      }
    },
  )
  return server
}

const app = express()
app.use(express.json({ type: '*/*' }))

app.post('/mcp', apiKeyAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string
  if (sessionId) {
    const transport = sessions.get(sessionId)
    if (!transport) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    await transport.handleRequest(req, res, req.body)
    return
  }

  // New session
  const newSessionId = crypto.randomUUID()
  const server = createMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => newSessionId,
  })
  transport.onclose = () => sessions.delete(newSessionId)
  await server.connect(transport)
  sessions.set(newSessionId, transport)
  await transport.handleRequest(req, res, req.body)
})

app.get('/mcp', apiKeyAuth, async (req, res) => {
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
  await transport.handleRequest(req, res)
})

app.delete('/mcp', apiKeyAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string
  if (!sessionId) {
    res.status(400).send('Missing MCP-Session-Id header')
    return
  }
  const transport = sessions.get(sessionId)
  if (transport) {
    await transport.close()
  }
  res.status(200).send('Session closed')
})

const PORT = process.env.MCP_PORT || 3001
app.listen(PORT, () => {
  console.log(`MCP server listening on port ${PORT}`)
})
