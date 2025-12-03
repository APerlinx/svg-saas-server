import dotenv from 'dotenv'

dotenv.config()

// Server Configuration
export const PORT = process.env.PORT || 4000
// Frontend URL
export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

// Authentication
export const JWT_SECRET = process.env.JWT_SECRET as string

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be defined')
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
