import dotenv from 'dotenv'

dotenv.config()

// Server Configuration
export const PORT = process.env.PORT || 4000

// Environment detection
export const NODE_ENV = process.env.NODE_ENV || 'development'
export const IS_PRODUCTION = NODE_ENV === 'production'
export const IS_DEVELOPMENT = NODE_ENV === 'development'
export const IS_TEST = NODE_ENV === 'test'

// Frontend URL
export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

// Authentication
export const JWT_SECRET = process.env.JWT_SECRET as string

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be defined and at least 32 characters long')
}

// AI Models / APIs
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string
// Add more AI model keys here as needed
// export const REPLICATE_API_KEY = process.env.REPLICATE_API_KEY as string
// export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY as string
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY must be defined')
}

// Email Service
export const RESEND_API_KEY = process.env.RESEND_API_KEY as string

if (!RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY must be defined in .env file')
}

// Redis Configuration
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// Google OAuth - validate at startup
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
export const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  throw new Error('Google OAuth credentials must be defined in .env file')
}

// GitHub OAuth - validate at startup
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET
export const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_REDIRECT_URI) {
  throw new Error('GitHub OAuth credentials must be defined in .env file')
}
