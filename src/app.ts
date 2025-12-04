import express from 'express'
import cors from 'cors'
import userRoutes from './routes/user.routes'
import authRoutes from './routes/auth.routes'
import svgRoutes from './routes/svg.routes'
import passport from './config/passport'
import { FRONTEND_URL } from './config/env'
import cookieParser from 'cookie-parser'
import { generateCsrfToken, validateCsrfToken } from './middleware/csrf'

const app = express()

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  })
)

app.use(express.json())
app.use(cookieParser())

// Add CSRF token generation middleware
app.use(generateCsrfToken)

// Initialize Passport middleware
app.use(passport.initialize())

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.send('OK')
})

//Auth
app.use('/api/auth', validateCsrfToken, authRoutes)
// users
app.use('/api/user', validateCsrfToken, userRoutes)
// SVG generation
app.use('/api/svg', validateCsrfToken, svgRoutes)

export default app
