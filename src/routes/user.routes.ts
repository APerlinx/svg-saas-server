import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

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
    console.error('Error fetching users:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// return user data (without passwordHash)
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.userId },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        coins: true,
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
    console.error('Error fetching user data:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
