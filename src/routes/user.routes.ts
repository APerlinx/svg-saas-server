import { Router } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// Get all users
router.get('/', async (req, res) => {
  const users = await prisma.user.findMany()
  res.json(users)
})

// return user data (without passwordHash)
router.get('/me', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user?.userId },
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

  res.json({ user })
})

export default router
