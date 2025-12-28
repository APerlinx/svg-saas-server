"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('../config/env', () => ({
    IS_TEST: false,
}));
jest.mock('../lib/redis', () => ({
    redisClient: {
        isOpen: true,
        eval: jest.fn(),
    },
}));
jest.mock('../lib/logger', () => ({
    logger: {
        warn: jest.fn(),
        error: jest.fn(),
    },
}));
const rateLimiter_1 = require("./rateLimiter");
const redis_1 = require("../lib/redis");
const logger_1 = require("../lib/logger");
const mockedRedis = redis_1.redisClient;
const mockedLogger = logger_1.logger;
const createLimiter = () => (0, rateLimiter_1.createRateLimiter)({
    windowMs: 60 * 1000,
    max: 5,
    message: 'Too many requests',
    keyPrefix: 'rl:test',
});
const buildResponse = () => {
    const res = {};
    res.setHeader = jest.fn();
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};
describe('rateLimiter middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedRedis.isOpen = true;
    });
    test('allows request when under limit', async () => {
        mockedRedis.eval.mockResolvedValue([3, 120]);
        const limiter = createLimiter();
        const req = { ip: '1.1.1.1' };
        const res = buildResponse();
        const next = jest.fn();
        await limiter(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '5');
        expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '3');
        expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
    });
    test('blocks request when limit exceeded', async () => {
        mockedRedis.eval.mockResolvedValue([-1, 45]);
        const limiter = createLimiter();
        const req = { ip: '2.2.2.2' };
        const res = buildResponse();
        const next = jest.fn();
        await limiter(req, res, next);
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith({ error: 'Too many requests' });
        expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '45');
        expect(mockedLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ limit: 5, ttl: 45 }), 'Rate limit exceeded');
        expect(next).not.toHaveBeenCalled();
    });
    test('skips limiting when redis is disconnected', async () => {
        mockedRedis.isOpen = false;
        const limiter = createLimiter();
        const req = { ip: '3.3.3.3' };
        const res = buildResponse();
        const next = jest.fn();
        await limiter(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(mockedRedis.eval).not.toHaveBeenCalled();
        expect(mockedLogger.warn).toHaveBeenCalledWith('Redis not connected, skipping rate limit');
    });
    test('fails open when redis throws', async () => {
        mockedRedis.eval.mockRejectedValue(new Error('redis down'));
        const limiter = createLimiter();
        const req = { ip: '4.4.4.4' };
        const res = buildResponse();
        const next = jest.fn();
        await limiter(req, res, next);
        expect(mockedLogger.error).toHaveBeenCalledWith({ error: expect.any(Error) }, 'Rate limiter error, allowing request');
        expect(next).toHaveBeenCalled();
    });
});
