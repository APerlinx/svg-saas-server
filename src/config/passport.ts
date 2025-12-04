import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { Strategy as GitHubStrategy } from 'passport-github2'
import prisma from '../lib/prisma'
import {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_REDIRECT_URI,
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
        const avatar = profile.photos?.[0]?.value

        if (!email) {
          console.error('No email from Google profile')
          return done(new Error('No email from Google'), false)
        }

        console.log('Google profile data:', {
          googleId,
          email,
          name,
          avatar,
        })

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
                name: name || existingUser.name,
                avatar: avatar || existingUser.avatar,
              },
            })
          } else {
            console.log('Creating new user:', email)
            // Create new user
            user = await prisma.user.create({
              data: {
                email,
                name,
                avatar,
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

          // Update Avatar if changed on google
          if (avatar && user.avatar !== avatar) {
            console.log('Updating avatar for user:', email)
            user = await prisma.user.update({
              where: { id: user.id },
              data: { avatar },
            })
          }
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

passport.use(
  new GitHubStrategy(
    {
      clientID: GITHUB_CLIENT_ID!,
      clientSecret: GITHUB_CLIENT_SECRET!,
      callbackURL: GITHUB_REDIRECT_URI!,
      scope: ['user:email'],
    },
    async (
      accessToken: string,
      refreshToken: string,
      profile: any,
      done: any
    ) => {
      try {
        const githubId = profile.id
        const email = profile.emails?.[0]?.value
        const name = profile.displayName || profile.username
        const avatar = profile.photos?.[0]?.value

        if (!email) {
          console.error('No email from GitHub profile')
          return done(new Error('No email from GitHub'), false)
        }

        console.log('GitHub profile data:', { githubId, email, name, avatar })

        let user = await prisma.user.findUnique({
          where: { providerId: githubId },
        })

        if (!user) {
          const existingUser = await prisma.user.findUnique({
            where: { email },
          })

          if (existingUser) {
            user = await prisma.user.update({
              where: { id: existingUser.id },
              data: {
                provider: 'GITHUB',
                providerId: githubId,
                name: name || existingUser.name,
                avatar: avatar || existingUser.avatar,
              },
            })
          } else {
            user = await prisma.user.create({
              data: {
                email,
                name,
                avatar,
                provider: 'GITHUB',
                providerId: githubId,
                passwordHash: null,
                coins: 10,
                termsAcceptedAt: new Date(),
              },
            })

            try {
              await sendWelcomeEmail(email, name || 'User')
            } catch (emailError) {
              console.error('Failed to send welcome email:', emailError)
            }
          }
        } else {
          if (avatar && user.avatar !== avatar) {
            user = await prisma.user.update({
              where: { id: user.id },
              data: { avatar },
            })
          }
        }

        return done(null, user)
      } catch (error) {
        console.error('GitHub OAuth error:', error)
        return done(error as Error, false)
      }
    }
  )
)

export default passport
