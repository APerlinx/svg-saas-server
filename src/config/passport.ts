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
import { logger } from '../lib/logger'

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
        const emailVerified = profile.emails?.[0]?.verified

        if (!email || !emailVerified) {
          logger.error({ googleId }, 'Email not verified from Google')
          return done(new Error('Email not verified'), false)
        }

        logger.debug({ googleId, email, name }, 'Google OAuth profile data')

        // Check if user exists by provider ID
        let user = await prisma.user.findUnique({
          where: {
            provider_providerId: {
              provider: 'GOOGLE',
              providerId: googleId,
            },
          },
        })

        if (!user) {
          logger.debug(
            { email },
            'User not found by providerId, checking by email'
          )

          // Check if user exists by email
          const existingUser = await prisma.user.findUnique({
            where: { email },
          })

          if (existingUser) {
            logger.info(
              { email, provider: 'GOOGLE' },
              'Linking Google account to existing user'
            )
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
            logger.info(
              { email, provider: 'GOOGLE' },
              'Creating new user via OAuth'
            )
            // Create new user
            user = await prisma.user.create({
              data: {
                email,
                name,
                avatar,
                provider: 'GOOGLE',
                providerId: googleId,
                passwordHash: null,
                credits: 3,
                termsAcceptedAt: new Date(),
              },
            })

            // Send welcome email (don't fail OAuth if email fails)
            try {
              await sendWelcomeEmail(email, name || 'User')
              logger.info({ email }, 'Welcome email sent to new OAuth user')
            } catch (emailError) {
              logger.error(
                { error: emailError, email },
                'Failed to send welcome email'
              )
            }
          }
        } else {
          logger.debug({ email }, 'Existing Google OAuth user found')

          // Update Avatar if changed on google
          if (avatar && user.avatar !== avatar) {
            logger.debug({ email }, 'Updating avatar from Google')
            user = await prisma.user.update({
              where: { id: user.id },
              data: { avatar },
            })
          }
        }

        // Return the full user object
        return done(null, user)
      } catch (error) {
        logger.error({ error }, 'Passport Google OAuth strategy error')
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
        const emailVerified = profile.emails?.[0]?.verified
        const name = profile.displayName || profile.username
        const avatar = profile.photos?.[0]?.value

        if (!email) {
          logger.error({ githubId }, 'No email from GitHub profile')
          return done(new Error('No email from GitHub'), false)
        }

        logger.debug({ githubId, email, name }, 'GitHub OAuth profile data')

        let user = await prisma.user.findUnique({
          where: {
            provider_providerId: {
              provider: 'GITHUB',
              providerId: githubId,
            },
          },
        })

        if (!user) {
          const existingUser = await prisma.user.findUnique({
            where: { email },
          })

          if (existingUser) {
            if (!emailVerified) {
              logger.error(
                { githubId, email },
                'Cannot link: GitHub email not verified'
              )
              return done(
                new Error(
                  'Please verify your email on GitHub to link accounts'
                ),
                false
              )
            }

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
                credits: 3,
                termsAcceptedAt: new Date(),
              },
            })

            try {
              await sendWelcomeEmail(email, name || 'User')
            } catch (emailError) {
              logger.error(
                { error: emailError, email },
                'Failed to send welcome email to GitHub user'
              )
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
        logger.error({ error }, 'GitHub OAuth error')
        return done(error as Error, false)
      }
    }
  )
)

export default passport
