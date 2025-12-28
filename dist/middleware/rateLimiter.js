"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.svgGenerationLimiter = exports.apiLimiter = exports.forgotPasswordLimiter = exports.authLimiter = exports.createRateLimiter = void 0;
const redis_1 = require("../lib/redis");
const env_1 = require("../config/env");
const logger_1 = require("../lib/logger");
const RATE_LIMIT_LUA = `
  local key = KEYS[1]              
  local window = tonumber(ARGV[1]) 
  local limit = tonumber(ARGV[2])  
  
  local current = redis.call('GET', key)
  
  if current and tonumber(current) >= limit then
   
    local ttl = redis.call('TTL', key)
   
    return {0, ttl}
  end
  
  local count = redis.call('INCR', key)
  
  if count == 1 then
    redis.call('EXPIRE', key, window)
  end
  
  local ttl = redis.call('TTL', key)     
  local remaining = limit - count         
  
  return {remaining, ttl}
`;
const createRateLimiter = (options) => {
    const { windowMs, max, message, keyPrefix, keyGenerator } = options;
    const windowSeconds = Math.floor(windowMs / 1000);
    return async (req, res, next) => {
        if (env_1.IS_TEST) {
            return next();
        }
        try {
            if (!redis_1.redisClient.isOpen) {
                logger_1.logger.warn('Redis not connected, skipping rate limit');
                return next();
            }
            const identifier = keyGenerator ? keyGenerator(req) : req.ip || 'unknown';
            const key = `${keyPrefix}:${identifier}`;
            const result = (await redis_1.redisClient.eval(RATE_LIMIT_LUA, {
                keys: [key],
                arguments: [windowSeconds.toString(), max.toString()],
            }));
            const [remaining, ttl] = result;
            res.setHeader('X-RateLimit-Limit', max.toString());
            res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining).toString());
            res.setHeader('X-RateLimit-Reset', (Date.now() + ttl * 1000).toString());
            if (remaining < 0) {
                res.setHeader('Retry-After', ttl.toString());
                logger_1.logger.warn({ key, identifier, limit: max, ttl }, 'Rate limit exceeded');
                return res.status(429).json({ error: message });
            }
            next();
        }
        catch (error) {
            logger_1.logger.error({ error }, 'Rate limiter error, allowing request');
            next();
        }
    };
};
exports.createRateLimiter = createRateLimiter;
exports.authLimiter = (0, exports.createRateLimiter)({
    windowMs: 15 * 60 * 1000, // 15 minutes = 900,000 milliseconds
    max: 5, // 5 attempts per IP per 15 minutes
    message: 'Too many authentication attempts. Please try again later.',
    keyPrefix: 'rl:auth', // Redis keys look like: "rl:auth:192.168.1.1"
});
exports.forgotPasswordLimiter = (0, exports.createRateLimiter)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // Only 3 attempts
    message: 'Too many password reset requests. Please try again later.',
    keyPrefix: 'rl:forgot',
});
exports.apiLimiter = (0, exports.createRateLimiter)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per IP per 15 minutes
    message: 'Too many requests. Please try again later.',
    keyPrefix: 'rl:api',
});
exports.svgGenerationLimiter = (0, exports.createRateLimiter)({
    windowMs: 60 * 60 * 1000, // 1 hour = 3,600,000 milliseconds
    max: 10, // 10 generations per user per hour
    message: 'Generation limit reached. Please try again later.',
    keyPrefix: 'rl:svg',
    keyGenerator: (req) => {
        if (req.user &&
            typeof req.user === 'object' &&
            'id' in req.user &&
            typeof req.user.id === 'string') {
            return req.user.id;
        }
        return req.ip || 'unknown';
    },
});
