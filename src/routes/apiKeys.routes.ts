/**
 * API Key Management Routes
 * Internal endpoints for users to manage their API keys via web app
 */

import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/auth'
import { requireUserId } from '../utils/getUserId'
import {
  createApiKey,
  getUserApiKeys,
  revokeApiKey,
  getApiKeyUsageStats,
} from '../services/apiKeyService'
import { getUserUsageSummary } from '../services/usageTrackingService'
import { logger } from '../lib/logger'

const router = Router()

/**
 * POST /api/keys
 * Create a new API key
 */
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req)
    const { name, description, environment, ipWhitelist, expiresAt } = req.body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' })
    }

    if (name.length > 100) {
      return res
        .status(400)
        .json({ error: 'Name must be 100 characters or less' })
    }

    const result = await createApiKey({
      userId,
      name: name.trim(),
      description,
      environment: environment === 'test' ? 'test' : 'production',
      ipWhitelist: Array.isArray(ipWhitelist) ? ipWhitelist : undefined,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    })

    logger.info(
      { userId, apiKeyId: result.id, keyPrefix: result.keyPrefix },
      'API key created via web app',
    )

    res.status(201).json({
      id: result.id,
      name: result.name,
      keyPrefix: result.keyPrefix,
      key: result.rawKey,
      createdAt: result.createdAt,
      warning: 'Save this key now. You will not be able to see it again.',
    })
  } catch (error: any) {
    logger.error(
      { error, userId: requireUserId(req) },
      'Failed to create API key',
    )

    if (error.message?.includes('API access requires')) {
      return res.status(403).json({ error: error.message })
    }

    if (error.message?.includes('Maximum API keys')) {
      return res.status(400).json({ error: error.message })
    }

    res.status(500).json({ error: 'Failed to create API key' })
  }
})

/**
 * GET /api/keys
 * List all API keys for the authenticated user
 */
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req)
    const keys = await getUserApiKeys(userId)

    res.json({ keys })
  } catch (error) {
    logger.error(
      { error, userId: requireUserId(req) },
      'Failed to list API keys',
    )
    res.status(500).json({ error: 'Failed to retrieve API keys' })
  }
})

/**
 * DELETE /api/keys/:id
 * Revoke an API key
 */
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req)
    const { id } = req.params

    const success = await revokeApiKey(id, userId)

    if (!success) {
      return res
        .status(404)
        .json({ error: 'API key not found or already revoked' })
    }

    res.json({ message: 'API key revoked successfully' })
  } catch (error) {
    logger.error(
      { error, userId: requireUserId(req), keyId: req.params.id },
      'Failed to revoke API key',
    )
    res.status(500).json({ error: 'Failed to revoke API key' })
  }
})

/**
 * GET /api/keys/:id/stats
 * Get usage statistics for a specific API key
 */
router.get(
  '/:id/stats',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const { id } = req.params

      const stats = await getApiKeyUsageStats(id, userId)

      res.json({ stats })
    } catch (error: any) {
      if (error.message === 'API key not found') {
        return res.status(404).json({ error: 'API key not found' })
      }

      logger.error(
        { error, userId: requireUserId(req), keyId: req.params.id },
        'Failed to get API key stats',
      )
      res.status(500).json({ error: 'Failed to retrieve statistics' })
    }
  },
)

/**
 * GET /api/keys/usage/summary
 * Get overall API usage summary for the user
 */
router.get(
  '/usage/summary',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const { startDate, endDate } = req.query

      const summary = await getUserUsageSummary(
        userId,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined,
      )

      res.json({ summary })
    } catch (error) {
      logger.error(
        { error, userId: requireUserId(req) },
        'Failed to get usage summary',
      )
      res.status(500).json({ error: 'Failed to retrieve usage summary' })
    }
  },
)

export default router
