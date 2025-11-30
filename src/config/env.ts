import dotenv from 'dotenv'

dotenv.config()

// Server Configuration
export const PORT = process.env.PORT || 4000

// Authentication
export const JWT_SECRET = process.env.JWT_SECRET as string

// AI Models / APIs
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string
// Add more AI model keys here as needed
// export const REPLICATE_API_KEY = process.env.REPLICATE_API_KEY as string
// export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY as string

// Validation - Required environment variables
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be defined')
}

if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY must be defined')
}
