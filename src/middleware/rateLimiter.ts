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

export const forgotPasswordLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  3, // 3 attempts (stricter)
  'Too many password reset requests. Please try again later.'
)

export const apiLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests
  'Too many requests. Please try again later.'
)
