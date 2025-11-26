import express from 'express'
import cors from 'cors'
import prisma from './lib/prisma'

const app = express()

app.use(cors())
app.use(express.json())

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('OK')
})

// Example endpoint to get all users
app.get('/users', async (req, res) => {
  const users = await prisma.user.findMany()
  res.json(users)
})

export default app
