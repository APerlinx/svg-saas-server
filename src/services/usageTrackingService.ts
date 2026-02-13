/**
 * Usage Tracking Service
 * Logs API requests for analytics, billing, and monitoring
 */

import prisma from '../lib/prisma'
import { logger } from '../lib/logger'

interface LogApiUsageParams {
  apiKeyId: string
  userId: string
  endpoint: string
  method: string
  statusCode: number
  latencyMs: number
  creditsUsed?: number
  tokensUsed?: number
}

/**
 * Log an API request to the usage log
 * Called after each API request completes
 */
export async function logApiUsage(params: LogApiUsageParams): Promise<void> {
  try {
    await prisma.apiKeyUsageLog.create({
      data: {
        apiKeyId: params.apiKeyId,
        userId: params.userId,
        endpoint: params.endpoint,
        method: params.method,
        statusCode: params.statusCode,
        timestamp: new Date(),
        latencyMs: params.latencyMs,
        creditsUsed: params.creditsUsed ?? 0,
        tokensUsed: params.tokensUsed ?? 0,
      },
    })
  } catch (error) {
    logger.error(
      {
        error,
        apiKeyId: params.apiKeyId,
        endpoint: params.endpoint,
      },
      'Failed to log API usage',
    )
  }
}

/**
 * Increment user's API quota usage
 * Called after successful API request
 */
export async function incrementApiQuota(userId: string): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        apiQuotaUsed: { increment: 1 },
      },
    })
  } catch (error) {
    logger.error(
      {
        error,
        userId,
      },
      'Failed to increment API quota',
    )
  }
}

/**
 * Get API usage summary for a user
 */
export async function getUserUsageSummary(
  userId: string,
  startDate?: Date,
  endDate?: Date,
) {
  const where: any = { userId }

  if (startDate || endDate) {
    where.timestamp = {}
    if (startDate) where.timestamp.gte = startDate
    if (endDate) where.timestamp.lte = endDate
  }

  const [totalRequests, successfulRequests, totalCredits, avgLatency] =
    await Promise.all([
      prisma.apiKeyUsageLog.count({ where }),
      prisma.apiKeyUsageLog.count({
        where: { ...where, statusCode: { gte: 200, lt: 300 } },
      }),
      prisma.apiKeyUsageLog.aggregate({
        where,
        _sum: { creditsUsed: true },
      }),
      prisma.apiKeyUsageLog.aggregate({
        where,
        _avg: { latencyMs: true },
      }),
    ])

  return {
    totalRequests,
    successfulRequests,
    failedRequests: totalRequests - successfulRequests,
    totalCreditsUsed: totalCredits._sum.creditsUsed || 0,
    averageLatencyMs: Math.round(avgLatency._avg.latencyMs || 0),
    successRate:
      totalRequests > 0
        ? Math.round((successfulRequests / totalRequests) * 100)
        : 0,
  }
}

/**
 * Get usage breakdown by endpoint
 */
export async function getEndpointUsageBreakdown(
  userId: string,
  startDate?: Date,
  endDate?: Date,
) {
  const where: any = { userId }

  if (startDate || endDate) {
    where.timestamp = {}
    if (startDate) where.timestamp.gte = startDate
    if (endDate) where.timestamp.lte = endDate
  }

  const usage = await prisma.apiKeyUsageLog.groupBy({
    by: ['endpoint', 'method'],
    where,
    _count: { id: true },
    _sum: { creditsUsed: true },
    _avg: { latencyMs: true },
    orderBy: {
      _count: {
        id: 'desc',
      },
    },
  })

  return usage.map((item) => ({
    endpoint: item.endpoint,
    method: item.method,
    requests: item._count.id,
    creditsUsed: item._sum.creditsUsed || 0,
    avgLatencyMs: Math.round(item._avg.latencyMs || 0),
  }))
}
