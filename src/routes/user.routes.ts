import { Router, Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'
import { getUserId, requireUserId } from '../utils/getUserId'
import { logger } from '../lib/logger'
import { VALID_SVG_STYLES, SvgStyle } from '../constants/svgStyles'
import { VALID_MODELS, AiModel } from '../constants/models'

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

    try {
      const userId = requireUserId(req)

      if (style && !VALID_SVG_STYLES.includes(style as SvgStyle)) {
        return res.status(400).json({
          error: `Invalid style. Must be one of: ${VALID_SVG_STYLES.join(
            ', '
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
          },
        })

        const hasMore = generations.length > limit
        const items = hasMore ? generations.slice(0, -1) : generations
        const nextCursor = hasMore ? items[items.length - 1]!.id : null

        return { generations: items, nextCursor }
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
        'Error fetching SVG history'
      )
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

export default router
