import { Router } from 'express'
import prisma from '../lib/prisma'

const router = Router()

// Get all users
router.get('/', async (req, res) => {
  const users = await prisma.user.findMany()
  res.json(users)
})

export default router
