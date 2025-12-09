import rateLimit from 'express-rate-limit'

// Generic rate limiter factory
export const createRateLimiter = (
  windowMs: number,
  max: number,
  message: string
) => {
  return rateLimit({
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
  })
}

// Specific limiters for different routes
export const authLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5, // 5 attempts change in production!
  'Too many authentication attempts. Please try again later.'
)

// Limiter for password reset requests
export const forgotPasswordLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  3, // 3 attempts (stricter)
  'Too many password reset requests. Please try again later.'
)

// Limiter for all API routes
export const apiLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests
  'Too many requests. Please try again later.'
)

// Limiter for SVG generation endpoint
export const svgGenerationLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  10, // 10 SVG generations per hour per IP
  'Too many SVG generation requests. Please try again later.'
)
