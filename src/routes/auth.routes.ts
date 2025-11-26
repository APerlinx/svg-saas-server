import { Router } from 'express'
import prisma from '../lib/prisma'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

const router = Router()

// User registration
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body
  // Basic validation
  if (!email || !password || !name) {
    return res.status(400).send('Missing required fields')
  }
  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
  })
  if (existingUser) {
    return res.status(409).send('User already exists')
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10) // 10 = salt rounds
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: hashedPassword,
      name,
    },
  })
  // Generate JWT token
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    return res.status(500).send('JWT_SECRET is not configured')
  }
  const token = jwt.sign({ userId: user.id }, jwtSecret, {
    expiresIn: '1h',
  })

  // Respond with token
  res.status(201).json({
    id: user.id,
    email: user.email,
    token,
  })
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body
  const user = await prisma.user.findUnique({
    where: { email },
  })
  if (!user) {
    return res.status(401).send('Invalid email or password')
  }
  const isMatch = await bcrypt.compare(password, user.passwordHash)
  if (!isMatch) {
    return res.status(401).send('Invalid email or password')
  }
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    return res.status(500).send('JWT_SECRET is not configured')
  }
  const token = jwt.sign({ userId: user.id }, jwtSecret, {
    expiresIn: '1h',
  })

  const safeUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      name: true,
      plan: true,
      credits: true,
      // passwordHash is excluded
    },
  })

  res.json({ token, user: safeUser })
})

export default router
