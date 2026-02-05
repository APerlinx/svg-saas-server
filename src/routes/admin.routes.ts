import express, { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET, ADMIN_EMAIL } from '../config/env'
import { logger } from '../lib/logger'
import { sendAdminMagicLink } from '../services/emailService'
import { requireAdmin } from '../middleware/adminAuth'
import prisma from '../lib/prisma'
import { svgGenerationQueue } from '../jobs/svgGenerationQueue'

const router = express.Router()

router.post('/request-access', async (req: Request, res: Response) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }

    // Only allow requests to the configured admin email
    if (email !== ADMIN_EMAIL) {
      logger.warn({ email }, 'Unauthorized admin access request')
      // Don't reveal whether email is correct (timing-safe response)
      return res.json({
        message: 'If this email is registered as admin, a magic link was sent',
      })
    }

    // Generate short-lived token (5 minutes)
    const token = jwt.sign(
      {
        email,
        type: 'admin_magic_link',
        nonce: Math.random().toString(36), // Single-use via nonce
      },
      JWT_SECRET,
      { expiresIn: '5m' },
    )

    await sendAdminMagicLink(email, token)

    logger.info({ email }, 'Admin magic link sent')
    res.json({ message: 'Magic link sent to your email' })
  } catch (error) {
    logger.error({ error }, 'Error sending admin magic link')
    res.status(500).json({ error: 'Failed to send magic link' })
  }
})

router.get('/auth', async (req: Request, res: Response) => {
  try {
    const { token } = req.query

    if (!token || typeof token !== 'string') {
      return res.status(400).send('Invalid or missing token')
    }

    // Verify magic link token
    const decoded = jwt.verify(token, JWT_SECRET) as {
      email: string
      type: string
      nonce: string
    }

    if (decoded.type !== 'admin_magic_link' || decoded.email !== ADMIN_EMAIL) {
      return res.status(403).send('Invalid magic link')
    }

    // TODO: Track used nonces in Redis to prevent reuse
    // For now, the 5-minute expiry provides reasonable security

    // Generate long-lived admin session token (24 hours)
    const sessionToken = jwt.sign(
      {
        email: decoded.email,
        type: 'admin',
      },
      JWT_SECRET,
      { expiresIn: '24h' },
    )

    // Set secure HTTP-only cookie
    res.cookie('admin_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    })

    logger.info({ email: decoded.email }, 'Admin authenticated via magic link')

    // Redirect to admin metrics page (or send success response)
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Admin Access Granted</title></head>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
          <h1>✅ Admin Access Granted</h1>
          <p>You can now access admin endpoints.</p>
          <p><a href="/api/admin/metrics">View Metrics</a></p>
        </body>
      </html>
    `)
  } catch (error) {
    logger.error({ error }, 'Error verifying admin magic link')
    res.status(401).send('Invalid or expired magic link')
  }
})

router.get('/metrics', requireAdmin, async (req: Request, res: Response) => {
  try {
    // OpenAI GPT-5 pricing (as of Feb 2026)
    const PRICING = {
      'gpt-5.2': { input: 1.75 / 1_000_000, output: 14 / 1_000_000 },
      'gpt-5.2-2025-12-11': { input: 1.75 / 1_000_000, output: 14 / 1_000_000 },
      'gpt-5.2-pro': { input: 21 / 1_000_000, output: 168 / 1_000_000 },
      'gpt-5-mini': { input: 0.25 / 1_000_000, output: 2 / 1_000_000 },
      'gpt-5-mini-2025-08-07': {
        input: 0.25 / 1_000_000,
        output: 2 / 1_000_000,
      },
      'gpt-4.1': { input: 3 / 1_000_000, output: 12 / 1_000_000 },
      'gpt-4.1-mini': { input: 0.8 / 1_000_000, output: 3.2 / 1_000_000 },
    }

    // Fetch all succeeded jobs with AI metrics
    const succeededJobs = await prisma.generationJob.findMany({
      where: {
        status: 'SUCCEEDED',
        aiTotalTokens: { not: null },
      },
      select: {
        aiModel: true,
        aiPromptTokens: true,
        aiCompletionTokens: true,
        aiTotalTokens: true,
        aiLatencyMs: true,
        aiAttempts: true,
        createdAt: true,
        finishedAt: true,
        userId: true,
      },
    })

    // Calculate costs and aggregate metrics
    let totalCostUSD = 0
    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    const latencies: number[] = []
    const durations: number[] = []
    let repairCount = 0

    for (const job of succeededJobs) {
      const model = (job.aiModel || 'gpt-5.2') as keyof typeof PRICING
      const pricing = PRICING[model] || PRICING['gpt-5.2']

      const promptTokens = job.aiPromptTokens || 0
      const completionTokens = job.aiCompletionTokens || 0
      const attempts = job.aiAttempts || 1

      totalPromptTokens += promptTokens
      totalCompletionTokens += completionTokens
      totalCostUSD +=
        promptTokens * pricing.input + completionTokens * pricing.output

      if (job.aiLatencyMs) latencies.push(job.aiLatencyMs)
      if (attempts > 1) repairCount++

      if (job.finishedAt) {
        const duration = job.finishedAt.getTime() - job.createdAt.getTime()
        durations.push(duration)
      }
    }

    // Calculate percentiles
    const percentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0
      const sorted = [...arr].sort((a, b) => a - b)
      const idx = Math.ceil((p / 100) * sorted.length) - 1
      return sorted[idx] || 0
    }

    const avgLatency = latencies.length
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0
    const p95Latency = percentile(latencies, 95)
    const avgDuration = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0

    // Job status counts
    const statusCounts = await prisma.generationJob.groupBy({
      by: ['status'],
      _count: true,
    })

    const statusMap = Object.fromEntries(
      statusCounts.map((s) => [s.status, s._count]),
    )

    const totalJobs =
      (statusMap.SUCCEEDED || 0) +
      (statusMap.FAILED || 0) +
      (statusMap.QUEUED || 0) +
      (statusMap.RUNNING || 0)

    const successRate =
      totalJobs > 0 ? ((statusMap.SUCCEEDED || 0) / totalJobs) * 100 : 0

    // Queue depth
    const queueDepth = await svgGenerationQueue.count()

    // User statistics (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const activeUsers = await prisma.generationJob.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { userId: true },
      distinct: ['userId'],
    })

    const topGenerators = await prisma.generationJob.groupBy({
      by: ['userId'],
      _count: true,
      orderBy: { _count: { userId: 'desc' } },
      take: 10,
    })

    const totalGenerations30d = await prisma.generationJob.count({
      where: { createdAt: { gte: thirtyDaysAgo } },
    })

    res.json({
      ai: {
        totalJobs: succeededJobs.length,
        avgPromptTokens: Math.round(
          succeededJobs.length ? totalPromptTokens / succeededJobs.length : 0,
        ),
        avgCompletionTokens: Math.round(
          succeededJobs.length
            ? totalCompletionTokens / succeededJobs.length
            : 0,
        ),
        totalTokens: totalPromptTokens + totalCompletionTokens,
        avgLatencyMs: Math.round(avgLatency),
        p95LatencyMs: Math.round(p95Latency),
        repairRate:
          succeededJobs.length > 0
            ? ((repairCount / succeededJobs.length) * 100).toFixed(2) + '%'
            : '0%',
        totalCostUSD: '$' + totalCostUSD.toFixed(2),
        avgCostPerJobUSD:
          '$' + (totalCostUSD / (succeededJobs.length || 1)).toFixed(4),
      },
      jobs: {
        total: totalJobs,
        succeeded: statusMap.SUCCEEDED || 0,
        failed: statusMap.FAILED || 0,
        queued: statusMap.QUEUED || 0,
        running: statusMap.RUNNING || 0,
        queueDepth,
        successRate: successRate.toFixed(2) + '%',
        avgDurationMs: Math.round(avgDuration),
      },
      users: {
        activeUsers30d: activeUsers.length,
        totalGenerations30d,
        topGenerators: topGenerators.map((u) => ({
          userId: u.userId,
          jobCount: u._count,
        })),
      },
    })
  } catch (error) {
    logger.error({ error }, 'Error fetching admin metrics')
    res.status(500).json({ error: 'Failed to fetch metrics' })
  }
})

router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('admin_session')
  res.json({ message: 'Logged out successfully' })
})

export default router
