import express from 'express'
import cors from 'cors'
import userRoutes from './routes/user.routes'
import authRoutes from './routes/auth.routes'
import svgRoutes from './routes/svg.routes'
import passport from './config/passport'

const app = express()

app.use(
  cors({
    origin: 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)

app.use(express.json())

// Initialize Passport middleware
app.use(passport.initialize())

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.send('OK')
})

// users
app.use('/api/user', userRoutes)
//Auth
app.use('/api/auth', authRoutes)
// SVG generation
app.use('/api/svg', svgRoutes)

export default app
