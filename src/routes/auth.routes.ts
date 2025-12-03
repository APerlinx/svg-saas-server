import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { FRONTEND_URL, JWT_SECRET } from '../config/env'
import { authMiddleware } from '../middleware/auth'
import { User as PrismaUser } from '@prisma/client'
import {
  createPasswordResetToken,
  hashResetToken,
} from '../utils/createPasswordResetToken'
import {
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from '../services/emailService'
import { authLimiter, forgotPasswordLimiter } from '../middleware/rateLimiter'
import { getUserIp } from '../utils/getUserIp'
import passport from '../config/passport'
import { requireUserId } from '../utils/getUserId'

const router = Router()

/**
 * TODO: BEFORE PRODUCTION - Implement Refresh Token System
 *
 * CURRENT ISSUE:
 * - Using single JWT with 1h expiration
 * - When user "logs out", token is still valid until expiration (security risk)
 * - Short expiration = poor UX (users logged out every hour)
 * - Long expiration = security risk (stolen tokens valid for days/weeks)
 *
 * WHY REFRESH TOKENS?
 * 1. Security: Access tokens expire quickly (15min) - limits damage if stolen
 * 2. UX: Refresh tokens last longer (7-30 days) - users stay logged in
 * 3. True Logout: Can revoke refresh tokens in database immediately
 * 4. Token Revocation: Can invalidate specific sessions (e.g., "logout from all devices")
 *
 * WHAT YOU NEED:
 * 1. Create RefreshToken model in Prisma schema
 *    - Store refresh tokens in database with userId and expiration
 * 2. Login/Register returns BOTH tokens:
 *    - accessToken (short: 15min-1h) - for API requests
 *    - refreshToken (long: 7-30d) - stored in DB and httpOnly cookie
 * 3. Create /auth/refresh endpoint:
 *    - Accepts refreshToken
 *    - Validates against database
 *    - Returns new accessToken
 * 4. Logout endpoint:
 *    - Deletes refreshToken from database
 *    - Token immediately invalid (true logout)
 * 5. Middleware checks:
 *    - Verify accessToken on each request (fast, no DB lookup)
 *    - If expired, frontend uses refreshToken to get new accessToken
 *
 * BENEFITS:
 * - Balance security (short access tokens) with UX (long refresh tokens)
 * - Logout actually works (revoke refresh token in DB)
 * - Can implement "logout from all devices" (delete all user's refresh tokens)
 * - Detect suspicious activity (monitor refresh token usage patterns)
 *
 * RESOURCES TO RESEARCH:
 * - JWT refresh token pattern
 * - Storing refresh tokens securely (httpOnly cookies vs localStorage)
 * - Token rotation (issue new refresh token on each use)
 * - Refresh token families (detect token reuse/theft)
 */

// User registration
router.post('/register', authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, name, agreedToTerms } = req.body
    // Basic validation
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    if (!email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email format' })
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: 'Password must be at least 8 characters' })
    }
    if (agreedToTerms !== true) {
      return res.status(400).json({
        message:
          'You must accept the Terms of Service and Privacy Policy to create an account',
      })
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    })
    if (existingUser) {
      return res
        .status(400)
        .json({ error: 'Email is invalid or already taken' })
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hashedPassword,
        name,
        coins: 10,
        termsAcceptedAt: new Date(),
        termsAcceptedIp: getUserIp(req),
      },
    })
    // Generate JWT token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: '24h',
    })

    await sendWelcomeEmail(email, name)

    // Respond with token
    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      token,
      coins: user.coins,
    })
  } catch (error) {
    console.error('Registration error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// User login
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, rememberMe } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        plan: true,
        coins: true,
        passwordHash: true,
      },
    })

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash!)
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: rememberMe ? '30d' : '24h',
    })
    const { passwordHash, ...safeUser } = user
    res.json({ token, user: safeUser })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/logout', authMiddleware, async (req: Request, res: Response) => {
  // Since im using stateless JWTs, logout is handled on the client side by deleting the token.
  // TODO: I should implement a token blacklist.
  res.json({ message: 'Logged out successfully' })
})

// Get current authenticated user
router.get(
  '/current-user',
  authMiddleware,
  async (req: Request, res: Response) => {
    const userId = requireUserId(req)
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      coins: user.coins || 0,
    }

    res.json(safeUser)
  }
)

router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  async (req: Request, res: Response) => {
    try {
      const { email } = req.body
      if (!email) {
        return res.status(400).json({ error: 'Email is required' })
      }
      const user = await prisma.user.findUnique({ where: { email } })
      if (!user) {
        console.log('Password reset requested for non-existent email:', email)
        return res.status(200).json({
          message: 'If that email is registered, a reset link has been sent.',
        })
      }

      const { resetToken, hashedToken, resetExpires } =
        createPasswordResetToken()
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: hashedToken,
          resetPasswordExpires: resetExpires,
        },
      })
      await sendPasswordResetEmail(email, resetToken)
      console.log('Password reset token generated for:', email)
      res.status(200).json({
        message: 'If that email is registered, a reset link has been sent.',
      })
    } catch (error) {
      console.error('Forgot password error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

router.post(
  '/reset-password',
  forgotPasswordLimiter,
  async (req: Request, res: Response) => {
    try {
      const { token: resetToken, newPassword } = req.body

      if (!resetToken || !newPassword) {
        return res.status(400).json({ error: 'Missing required fields' })
      }
      if (newPassword.length < 8) {
        return res
          .status(400)
          .json({ error: 'Password must be at least 8 characters' })
      }
      const hashedToken = hashResetToken(resetToken)
      const user = await prisma.user.findFirst({
        where: {
          resetPasswordToken: hashedToken,
          resetPasswordExpires: { gt: new Date() },
        },
      })

      if (!user) {
        return res.status(400).json({ error: 'Invalid or expired reset token' })
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10)
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashedPassword,
          resetPasswordToken: null,
          resetPasswordExpires: null,
        },
      })
      res.status(200).json({ message: 'Password has been reset successfully' })
    } catch (error) {
      console.error('Reset password error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

// Google OAuth
router.get('/google', (req: Request, res: Response, next) => {
  console.log('=== Starting Google OAuth Flow ===')

  const redirectUrl = (req.query.redirectUrl as string) || '/'

  console.log('Redirect URL:', redirectUrl)

  // Store redirectUrl in state parameter to retrieve after OAuth callback
  const state = Buffer.from(
    JSON.stringify({ redirectUrl, timestamp: Date.now() })
  ).toString('base64')

  // Redirect user to Google's login page
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    state,
  })(req, res, next)
})
// Handle callback from Google
router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: `${FRONTEND_URL}/signin?error=oauth_failed`,
  }),
  async (req: Request, res: Response) => {
    try {
      // Check if user exists first
      if (!req.user) {
        return res.redirect(`${FRONTEND_URL}/signin?error=no_user`)
      }

      const user = req.user as PrismaUser

      if (!user?.id) {
        return res.redirect(`${FRONTEND_URL}/signin?error=no_user`)
      }

      // Generate JWT token
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: '24h',
      })

      // Extract redirectUrl from state parameter
      const state = req.query.state as string
      let redirectUrl = '/' // Default

      if (state) {
        try {
          const decoded = JSON.parse(Buffer.from(state, 'base64').toString())

          const stateAge = Date.now() - (decoded.timestamp || 0)
          if (stateAge > 10 * 60 * 1000) {
            console.warn('⚠️  OAuth state expired, using default redirect')
          } else {
            redirectUrl = decoded.redirectUrl || '/'
          }
        } catch (error) {
          console.error('❌ Error decoding state:', error)
        }
      }

      const finalUrl = `${FRONTEND_URL}/auth/callback?token=${token}&redirect=${encodeURIComponent(
        redirectUrl
      )}`
      console.log('✅ Redirecting to:', finalUrl)

      // Redirect to frontend with token and original redirectUrl
      res.redirect(finalUrl)
    } catch (error) {
      console.error('❌ Google OAuth callback error:', error)
      res.redirect(`${FRONTEND_URL}/signin?error=server_error`)
    }
  }
)

// GitHub OAuth
router.get('/github', (req: Request, res: Response, next) => {
  const redirectUrl = (req.query.redirectUrl as string) || '/'

  // Store redirectUrl in state parameter to retrieve after OAuth callback
  const state = Buffer.from(
    JSON.stringify({ redirectUrl, timestamp: Date.now() })
  ).toString('base64')

  // Redirect user to GitHub's login page
  passport.authenticate('github', {
    scope: ['user:email'],
    state,
  })(req, res, next)
})

// Handle callback from GitHub
router.get(
  '/github/callback',
  passport.authenticate('github', {
    session: false,
    failureRedirect: `${FRONTEND_URL}/signin?error=oauth_failed`,
  }),
  async (req: Request, res: Response) => {
    try {
      // Check if user exists first
      if (!req.user) {
        return res.redirect(`${FRONTEND_URL}/signin?error=no_user`)
      }

      const user = req.user as PrismaUser

      if (!user?.id) {
        return res.redirect(`${FRONTEND_URL}/signin?error=no_user`)
      }

      // Generate JWT token
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: '24h',
      })

      // Extract redirectUrl from state parameter
      const state = req.query.state as string
      let redirectUrl = '/' // Default

      if (state) {
        try {
          const decoded = JSON.parse(Buffer.from(state, 'base64').toString())

          const stateAge = Date.now() - (decoded.timestamp || 0)
          if (stateAge > 10 * 60 * 1000) {
            console.warn('⚠️  OAuth state expired, using default redirect')
          } else {
            redirectUrl = decoded.redirectUrl || '/'
          }
        } catch (error) {
          console.error('❌ Error decoding state:', error)
        }
      }

      const finalUrl = `${FRONTEND_URL}/auth/callback?token=${token}&redirect=${encodeURIComponent(
        redirectUrl
      )}`
      console.log('✅ Redirecting to:', finalUrl)

      // Redirect to frontend with token and original redirectUrl
      res.redirect(finalUrl)
    } catch (error) {
      console.error('❌ GitHub OAuth callback error:', error)
      res.redirect(`${FRONTEND_URL}/signin?error=server_error`)
    }
  }
)

export default router
