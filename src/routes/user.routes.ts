import { Router, Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import * as Sentry from '@sentry/node'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'
import { getUserId, requireUserId } from '../utils/getUserId'
import { logger } from '../lib/logger'
import { VALID_SVG_STYLES, SvgStyle } from '../constants/svgStyles'
import { VALID_MODELS, AiModel } from '../constants/models'
import {
  IS_PRODUCTION,
  IS_S3_ENABLED,
  PUBLIC_ASSETS_BASE_URL,
} from '../config/env'
import { deleteSvg } from '../lib/s3'

const router = Router()

// Get all users
router.get('/', authMiddleware, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        // Exclude passwordHash
      },
    })
    res.json(users)
  } catch (error) {
    logger.error({ error }, 'Error fetching users')
    res.status(500).json({ error: 'Internal server error' })
  }
})

// return user data (without passwordHash)
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        credits: true,
        createdAt: true,
        updatedAt: true,
        generations: true,
        // passwordHash is excluded by not including it
      },
    })
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }
    res.json({ user })
  } catch (error) {
    logger.error({ error, userId: getUserId(req) }, 'Error fetching user data')
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get(
  '/generations',
  authMiddleware,
  async (req: Request, res: Response) => {
    const rawLimit = Number(req.query.limit)
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 100)
      : 50

    const cursor =
      typeof req.query.cursor === 'string' ? req.query.cursor.trim() : undefined
    const style =
      typeof req.query.style === 'string' ? req.query.style.trim() : undefined
    const model =
      typeof req.query.model === 'string' ? req.query.model.trim() : undefined
    const rawPrivacy =
      typeof req.query.privacy === 'string'
        ? req.query.privacy.trim().toLowerCase()
        : undefined

    const isFirstPage = !cursor

    const buildSvgUrl = (s3Key?: string | null) => {
      if (!s3Key) return null
      if (!PUBLIC_ASSETS_BASE_URL) return null
      return `${PUBLIC_ASSETS_BASE_URL}/${s3Key}`
    }

    try {
      const userId = requireUserId(req)

      if (style && !VALID_SVG_STYLES.includes(style as SvgStyle)) {
        return res.status(400).json({
          error: `Invalid style. Must be one of: ${VALID_SVG_STYLES.join(
            ', ',
          )}`,
        })
      }

      if (model && !VALID_MODELS.includes(model as AiModel)) {
        return res.status(400).json({
          error: `Invalid model. Must be one of: ${VALID_MODELS.join(', ')}`,
        })
      }

      let privacyWhere: { privacy?: boolean } = {}
      if (rawPrivacy && rawPrivacy !== 'all') {
        if (rawPrivacy === 'public' || rawPrivacy === 'false') {
          privacyWhere = { privacy: false }
        } else if (rawPrivacy === 'private' || rawPrivacy === 'true') {
          privacyWhere = { privacy: true }
        } else {
          return res.status(400).json({
            error: 'Invalid privacy. Must be one of: all, public, private',
            errorCode: 'INVALID_PRIVACY',
          })
        }
      }

      const where = {
        userId,
        ...(style ? { style } : {}),
        ...(model ? { model } : {}),
        ...privacyWhere,
      }

      const fetchPage = async (pageCursor?: string) => {
        const generations = await prisma.svgGeneration.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          ...(pageCursor ? { cursor: { id: pageCursor }, skip: 1 } : {}),
          select: {
            id: true,
            prompt: true,
            style: true,
            model: true,
            privacy: true,
            creditsUsed: true,
            createdAt: true,
            s3Key: true,
          },
        })

        const hasMore = generations.length > limit
        const items = hasMore ? generations.slice(0, -1) : generations
        const nextCursor = hasMore ? items[items.length - 1]!.id : null

        return {
          generations: items.map((g) => ({
            id: g.id,
            prompt: g.prompt,
            style: g.style,
            model: g.model,
            privacy: g.privacy,
            creditsUsed: g.creditsUsed,
            createdAt: g.createdAt,
            svgUrl: buildSvgUrl(g.s3Key),
          })),
          nextCursor,
        }
      }

      if (isFirstPage) {
        return res.json(await fetchPage(undefined))
      }

      return res.json(await fetchPage(cursor))
    } catch (error) {
      if (
        cursor &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        return res.status(400).json({
          error: 'Invalid cursor',
          errorCode: 'INVALID_CURSOR',
        })
      }

      logger.error(
        { error, userId: getUserId(req) },
        'Error fetching SVG history',
      )
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

router.delete(
  '/generations/:id',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req)
      const generationId = req.params.id
      if (typeof generationId !== 'string' || !generationId.trim()) {
        return res.status(400).json({ error: 'Invalid generation id' })
      }

      let s3Key: string | null | undefined

      const generation = await prisma.svgGeneration.findFirst({
        where: { id: generationId, userId },
        select: { s3Key: true },
      })

      s3Key = generation?.s3Key

      if (!generation) {
        return res.status(404).json({ error: 'SVG generation not found' })
      }

      const deleteResult = await prisma.svgGeneration.deleteMany({
        where: { id: generationId, userId },
      })

      if (deleteResult.count !== 1) {
        logger.warn(
          { generationId, userId, s3Key, deleteCount: deleteResult.count },
          'DB delete returned unexpected count for SVG generation',
        )

        if (IS_PRODUCTION && process.env.SENTRY_DSN) {
          Sentry.captureMessage(
            'DB delete returned unexpected count for SVG generation',
            {
              level: 'warning',
              tags: {
                feature: 'delete_generation',
                phase: 'db_delete',
              },
              extra: {
                generationId,
                userId,
                s3Key,
                deleteCount: deleteResult.count,
              },
            },
          )
        }

        return res.status(404).json({ error: 'SVG generation not found' })
      }

      if (IS_S3_ENABLED && generation.s3Key) {
        try {
          await deleteSvg(generation.s3Key)
        } catch (error) {
          logger.error(
            { error, generationId, userId, s3Key: generation.s3Key },
            'Failed to delete SVG from S3 after DB deletion',
          )

          if (IS_PRODUCTION && process.env.SENTRY_DSN) {
            Sentry.captureException(error, {
              tags: {
                feature: 'delete_generation',
                phase: 's3_delete',
              },
              extra: {
                generationId,
                userId,
                s3Key: generation.s3Key,
              },
            })
          }
        }
      }

      res.json({ success: true })
    } catch (error) {
      logger.error(
        { error, userId: getUserId(req) },
        'Error deleting SVG generation',
      )

      if (IS_PRODUCTION && process.env.SENTRY_DSN) {
        Sentry.captureException(error, {
          tags: {
            feature: 'delete_generation',
            phase: 'handler',
          },
          extra: {
            generationId: req.params.id,
            userId: getUserId(req),
          },
        })
      }

      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

export default router
