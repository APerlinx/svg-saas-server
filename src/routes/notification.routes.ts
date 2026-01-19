import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/auth'
import { requireUserId } from '../utils/getUserId'
import prisma from '../lib/prisma'

const router = Router()

router.get('/latest', authMiddleware, async (req: Request, res: Response) => {
  const userId = requireUserId(req)

  const rawLimit = Number(req.query.limit)
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 100)
    : 5

  const cursor =
    typeof req.query.cursor === 'string' ? req.query.cursor : undefined

  try {
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        data: true,
        createdAt: true,
        readAt: true,
      },
    })

    const hasMore = notifications.length > limit
    const items = hasMore ? notifications.slice(0, -1) : notifications
    const nextCursor = hasMore ? items[items.length - 1]?.id : null

    return res.json({ notifications: items, nextCursor })
  } catch {
    return res.status(500).json({ error: 'Failed to fetch notifications' })
  }
})

router.get('/badge', authMiddleware, async (req: Request, res: Response) => {
  const userId = requireUserId(req)
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationsLastSeenAt: true },
    })
    const lastSeenAt = user?.notificationsLastSeenAt
    const unreadCount = await prisma.notification.count({
      where: {
        userId,
        ...(lastSeenAt ? { createdAt: { gt: lastSeenAt } } : {}),
      },
    })

    return res.json({ unreadCount })
  } catch {
    return res.status(500).json({ error: 'Failed to fetch unread counts' })
  }
})

router.post('/seen', authMiddleware, async (req: Request, res: Response) => {
  const userId = requireUserId(req)
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { notificationsLastSeenAt: new Date() },
    })

    return res.json({ ok: true })
  } catch {
    return res
      .status(500)
      .json({ error: 'Failed to mark notifications as seen' })
  }
})

export default router
