import dotenv from 'dotenv'

dotenv.config()

export const JWT_SECRET = process.env.JWT_SECRET as string
export const PORT = process.env.PORT || 4000

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be defined in .env file')
}
