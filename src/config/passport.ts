import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import prisma from '../lib/prisma'
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} from './env'
import { sendWelcomeEmail } from '../services/emailService'

// Configure Google OAuth strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID!,
      clientSecret: GOOGLE_CLIENT_SECRET!,
      callbackURL: GOOGLE_REDIRECT_URI!,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Extract user info from Google profile
        const googleId = profile.id
        const email = profile.emails?.[0]?.value
        const name = profile.displayName

        if (!email) {
          console.error('No email from Google profile')
          return done(new Error('No email from Google'), false)
        }

        console.log('Google OAuth: Processing user:', email)

        // Check if user exists by providerId (Google ID)
        let user = await prisma.user.findUnique({
          where: { providerId: googleId },
        })

        if (!user) {
          console.log('User not found by providerId, checking by email...')

          // Check if user exists by email
          const existingUser = await prisma.user.findUnique({
            where: { email },
          })

          if (existingUser) {
            console.log('Linking Google account to existing user:', email)
            // Link Google account to existing email account
            user = await prisma.user.update({
              where: { id: existingUser.id },
              data: {
                provider: 'GOOGLE',
                providerId: googleId,
                name: name || existingUser.name, // Update name if provided
              },
            })
          } else {
            console.log('Creating new user:', email)
            // Create new user
            user = await prisma.user.create({
              data: {
                email,
                name,
                provider: 'GOOGLE',
                providerId: googleId,
                passwordHash: null,
                coins: 10,
                termsAcceptedAt: new Date(),
              },
            })

            // Send welcome email (don't fail OAuth if email fails)
            try {
              await sendWelcomeEmail(email, name || 'User')
              console.log('Welcome email sent to:', email)
            } catch (emailError) {
              console.error('Failed to send welcome email:', emailError)
            }
          }
        } else {
          console.log('Existing user found:', email)
        }

        console.log('Passport strategy: Returning user with id:', user.id)

        // Return the full user object
        return done(null, user)
      } catch (error) {
        console.error('Passport Google OAuth strategy error:', error)
        return done(error as Error, false)
      }
    }
  )
)

export default passport
