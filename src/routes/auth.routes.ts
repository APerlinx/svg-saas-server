import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { FRONTEND_URL, IS_PRODUCTION, JWT_SECRET } from '../config/env'
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
import { sanitizeInput } from '../utils/sanitizeInput'
import {
  validateEmail,
  validatePassword,
  validateName,
} from '../utils/validateInput'
import {
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY_DAYS,
} from '../constants/tokenExpiry'
import {
  clearAuthCookie,
  setAccessTokenCookie,
  setAuthCookie,
  setRefreshTokenCookie,
} from '../utils/setAuthCookie'
import {
  createRefreshToken,
  revokeAllUserTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyRefreshToken,
} from '../utils/refreshToken'

const router = Router()

// User registration
router.post('/register', authLimiter, async (req: Request, res: Response) => {
  try {
    let { email, password, name, agreedToTerms } = req.body

    email = sanitizeInput(email?.toLowerCase() || '')
    name = sanitizeInput(name || '')

    // Validate inputs
    const emailError = validateEmail(email)
    if (emailError) {
      return res.status(400).json({ error: emailError })
    }

    const passwordError = validatePassword(password)
    if (passwordError) {
      return res.status(400).json({ error: passwordError })
    }

    const nameError = validateName(name)
    if (nameError) {
      return res.status(400).json({ error: nameError })
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
        credits: 10,
        termsAcceptedAt: new Date(),
        termsAcceptedIp: getUserIp(req),
      },
    })
    // Generate access token (short-lived)
    const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    })

    // Generate refresh token (long-lived, stored in DB)
    const refreshToken = await createRefreshToken(
      user.id,
      REFRESH_TOKEN_EXPIRY_DAYS,
      getUserIp(req),
      req.headers['user-agent']
    )

    // Send welcome email
    await sendWelcomeEmail(email, name)

    // Set both cookies
    setAccessTokenCookie(res, accessToken)
    setRefreshTokenCookie(res, refreshToken, false)

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        credits: user.credits,
        avatar: user.avatar,
      },
    })
  } catch (error) {
    console.error('Registration error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// User login
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    let { email, password, rememberMe } = req.body
    email = sanitizeInput(email?.toLowerCase() || '')

    // Validate inputs
    const emailError = validateEmail(email)
    if (emailError) {
      return res.status(400).json({ error: emailError })
    }

    const passwordError = validatePassword(password)
    if (passwordError) {
      return res.status(400).json({ error: passwordError })
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        plan: true,
        credits: true,
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

    // Generate access token
    const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    })

    // Generate refresh token
    const expiryDays = rememberMe ? 30 : REFRESH_TOKEN_EXPIRY_DAYS
    const refreshToken = await createRefreshToken(
      user.id,
      expiryDays,
      getUserIp(req),
      req.headers['user-agent']
    )

    // Set both cookies
    setAccessTokenCookie(res, accessToken)
    setRefreshTokenCookie(res, refreshToken, rememberMe)

    const { passwordHash, ...safeUser } = user
    res.json({ user: safeUser })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// User logout
router.post('/logout', authMiddleware, async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies.refreshToken

    // Revoke refresh token from database
    if (refreshToken) {
      await revokeRefreshToken(refreshToken)
    }

    // Clear cookies
    clearAuthCookie(res)

    res.json({ message: 'Logged out successfully' })
  } catch (error) {
    console.error('Logout error:', error)
    // Still clear cookies even if DB operation fails
    clearAuthCookie(res)
    res.json({ message: 'Logged out successfully' })
  }
})

// Refresh access token
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const oldRefreshToken = req.cookies.refreshToken
    if (!oldRefreshToken) {
      return res.status(401).json({ error: 'No refresh token provided' })
    }

    // Verify refresh token and get userId
    const userId = await verifyRefreshToken(oldRefreshToken)

    if (!userId) {
      clearAuthCookie(res)
      return res.status(401).json({ error: 'Invalid or expired refresh token' })
    }

    // Generate new access token
    const newAccessToken = jwt.sign({ userId }, JWT_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    })

    // ROTATION: Create new refresh token and delete old one
    const newRefreshToken = await rotateRefreshToken(
      oldRefreshToken,
      userId,
      REFRESH_TOKEN_EXPIRY_DAYS,
      getUserIp(req),
      req.headers['user-agent']
    )

    if (!newRefreshToken) {
      clearAuthCookie(res)
      return res.status(401).json({ error: 'Token rotation failed' })
    }

    // Set both new tokens
    setAccessTokenCookie(res, newAccessToken)
    setRefreshTokenCookie(res, newRefreshToken, false)

    res.json({ message: 'Token refreshed successfully' })
  } catch (error) {
    console.error('Token refresh error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get active sessions
router.get('/sessions', authMiddleware, async (req, res) => {
  const userId = requireUserId(req)

  const sessions = await prisma.refreshToken.findMany({
    where: { userId },
    select: {
      id: true,
      createdAt: true,
      lastUsedAt: true,
      ipAddress: true,
      userAgent: true,
    },
  })

  res.json({ sessions })
})

// Revoke specific session
router.delete('/sessions/:id', authMiddleware, async (req, res) => {
  const userId = requireUserId(req)
  const { id } = req.params

  await prisma.refreshToken.deleteMany({
    where: { id, userId }, // Ensure user owns this token
  })

  res.json({ message: 'Session revoked' })
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
      credits: user.credits || 0,
    }

    res.json(safeUser)
  }
)

// Forgot password
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  async (req: Request, res: Response) => {
    try {
      let { email } = req.body
      email = sanitizeInput(email?.toLowerCase() || '')

      // Validate email
      const emailError = validateEmail(email)
      if (emailError) {
        return res.status(400).json({ error: emailError })
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

// Reset password
router.post(
  '/reset-password',
  forgotPasswordLimiter,
  async (req: Request, res: Response) => {
    try {
      const { token: resetToken, newPassword } = req.body

      if (!resetToken || !newPassword) {
        return res.status(400).json({ error: 'Missing required fields' })
      }

      // Validate password
      const passwordError = validatePassword(newPassword)
      if (passwordError) {
        return res.status(400).json({ error: passwordError })
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

      // IMPORTANT: Revoke all refresh tokens when password is reset (security)
      await revokeAllUserTokens(user.id)

      res.status(200).json({
        message: 'Password has been reset successfully. Please log in again.',
      })
    } catch (error) {
      console.error('Reset password error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

// Google OAuth
router.get('/google', (req: Request, res: Response, next) => {
  const redirectUrl = (req.query.redirectUrl as string) || '/'

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
      if (!req.user) {
        return res.redirect(`${FRONTEND_URL}/signin?error=no_user`)
      }

      const user = req.user as PrismaUser

      if (!user?.id) {
        return res.redirect(`${FRONTEND_URL}/signin?error=no_user`)
      }

      // Generate access token
      const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: ACCESS_TOKEN_EXPIRY,
      })

      // Generate refresh token
      const refreshToken = await createRefreshToken(
        user.id,
        REFRESH_TOKEN_EXPIRY_DAYS,
        getUserIp(req),
        req.headers['user-agent']
      )

      // Set both cookies
      setAccessTokenCookie(res, accessToken)
      setRefreshTokenCookie(res, refreshToken, false)

      // Extract redirectUrl from state parameter
      const state = req.query.state as string
      let redirectUrl = '/' // Default

      if (state) {
        try {
          const decoded = JSON.parse(Buffer.from(state, 'base64').toString())

          const stateAge = Date.now() - (decoded.timestamp || 0)
          if (stateAge > 10 * 60 * 1000) {
            // State too old, use default
          } else {
            redirectUrl = decoded.redirectUrl || '/'
          }
        } catch (error) {
          console.error('Error decoding state:', error)
        }
      }

      res.redirect(`${FRONTEND_URL}${redirectUrl}`)
    } catch (error) {
      console.error('Google OAuth callback error:', error)
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
      if (!req.user) {
        return res.redirect(`${FRONTEND_URL}/signin?error=no_user`)
      }

      const user = req.user as PrismaUser

      if (!user?.id) {
        return res.redirect(`${FRONTEND_URL}/signin?error=no_user`)
      }

      // Generate access token
      const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: ACCESS_TOKEN_EXPIRY,
      })

      // Generate refresh token
      const refreshToken = await createRefreshToken(
        user.id,
        REFRESH_TOKEN_EXPIRY_DAYS,
        getUserIp(req),
        req.headers['user-agent']
      )

      // Set both cookies
      setAccessTokenCookie(res, accessToken)
      setRefreshTokenCookie(res, refreshToken, false)

      // Extract redirectUrl from state parameter
      const state = req.query.state as string
      let redirectUrl = '/' // Default

      if (state) {
        try {
          const decoded = JSON.parse(Buffer.from(state, 'base64').toString())

          const stateAge = Date.now() - (decoded.timestamp || 0)
          if (stateAge > 10 * 60 * 1000) {
            // State too old, use default
          } else {
            redirectUrl = decoded.redirectUrl || '/'
          }
        } catch (error) {
          console.error('❌ Error decoding state:', error)
        }
      }

      res.redirect(`${FRONTEND_URL}${redirectUrl}`)
    } catch (error) {
      console.error('GitHub OAuth callback error:', error)
      res.redirect(`${FRONTEND_URL}/signin?error=server_error`)
    }
  }
)

export default router
