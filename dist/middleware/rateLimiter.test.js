"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Mock BEFORE imports - mocks must be hoisted
jest.mock('../config/env', () => ({
    IS_TEST: false,
    IS_PRODUCTION: false,
}));
jest.mock('../lib/redis', () => ({
    redisClient: {
        isOpen: true,
        eval: jest.fn(),
        incr: jest.fn(),
        expire: jest.fn(),
        get: jest.fn(),
    },
}));
jest.mock('../lib/prisma', () => ({
    __esModule: true,
    default: {
        user: {
            findUnique: jest.fn(),
        },
    },
}));
jest.mock('../lib/logger', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}));
jest.mock('@sentry/node', () => ({
    captureMessage: jest.fn(),
}));
const rateLimiter_1 = require("./rateLimiter");
const redis_1 = require("../lib/redis");
const logger_1 = require("../lib/logger");
const prisma_1 = __importDefault(require("../lib/prisma"));
const Sentry = __importStar(require("@sentry/node"));
const env_1 = require("../config/env");
const mockedRedis = redis_1.redisClient;
const mockedLogger = logger_1.logger;
const mockedSentry = Sentry;
describe('rateLimiter middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedRedis.isOpen = true;
        mockedSentry.captureMessage.mockClear();
    });
    it('IS_TEST should be mocked to false', () => {
        expect(env_1.IS_TEST).toBe(false);
    });
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
        mockedRedis.eval.mockResolvedValue([0, 45]);
        const limiter = createLimiter();
        const req = {
            ip: '2.2.2.2',
            path: '/test',
            method: 'GET',
            get: jest.fn(),
        };
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
describe('Plan-Based Rate Limiter', () => {
    let req;
    let res;
    let next;
    const buildResponse = () => {
        const res = {};
        res.setHeader = jest.fn();
        res.status = jest.fn().mockReturnValue(res);
        res.json = jest.fn().mockReturnValue(res);
        return res;
    };
    beforeEach(() => {
        jest.clearAllMocks();
        mockedRedis.isOpen = true;
        req = {
            path: '/v1/svg/generate',
            method: 'POST',
            apiUser: { id: 'user-123', plan: 'FREE' },
        };
        res = buildResponse();
        next = jest.fn();
    });
    describe('FREE plan', () => {
        beforeEach(() => {
            ;
            prisma_1.default.user.findUnique.mockResolvedValue({
                id: 'user-123',
                plan: 'FREE',
            });
        });
        test('allows requests within limit (20/hour)', async () => {
            mockedRedis.incr.mockResolvedValue(5);
            mockedRedis.expire.mockResolvedValue(true);
            const limiter = (0, rateLimiter_1.createPlanRateLimiter)();
            await limiter(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
            expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '20');
            expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '15');
        });
        test('blocks requests exceeding limit', async () => {
            mockedRedis.incr.mockResolvedValue(21);
            const limiter = (0, rateLimiter_1.createPlanRateLimiter)();
            await limiter(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: 'Rate limit exceeded',
                message: expect.stringContaining('20 requests per hour'),
            }));
        });
        test('sets expiry on first request', async () => {
            mockedRedis.incr.mockResolvedValue(1);
            mockedRedis.expire.mockResolvedValue(true);
            const limiter = (0, rateLimiter_1.createPlanRateLimiter)();
            await limiter(req, res, next);
            expect(mockedRedis.expire).toHaveBeenCalledWith(expect.stringContaining('ratelimit:plan:user-123:'), 3600);
        });
    });
    describe('SUPPORTER plan', () => {
        beforeEach(() => {
            ;
            prisma_1.default.user.findUnique.mockResolvedValue({
                id: 'user-456',
                plan: 'SUPPORTER',
            });
            req.apiUser = { id: 'user-456', plan: 'SUPPORTER' };
        });
        test('allows higher limits (60/hour)', async () => {
            mockedRedis.incr.mockResolvedValue(50);
            const limiter = (0, rateLimiter_1.createPlanRateLimiter)();
            await limiter(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '60');
            expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '10');
        });
        test('blocks at 61st request', async () => {
            mockedRedis.incr.mockResolvedValue(61);
            const limiter = (0, rateLimiter_1.createPlanRateLimiter)();
            await limiter(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(429);
        });
    });
    describe('authentication', () => {
        test('requires auth by default', async () => {
            req.apiUser = undefined;
            req.user = undefined;
            const limiter = (0, rateLimiter_1.createPlanRateLimiter)();
            await limiter(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
        });
        test('skips check if skipAuth=true', async () => {
            req.apiUser = undefined;
            req.user = undefined;
            const limiter = (0, rateLimiter_1.createPlanRateLimiter)({ skipAuth: true });
            await limiter(req, res, next);
            expect(next).toHaveBeenCalled();
        });
        test('supports session auth', async () => {
            req.apiUser = undefined;
            req.user = { id: 'user-123' };
            prisma_1.default.user.findUnique.mockResolvedValue({
                id: 'user-123',
                plan: 'FREE',
            });
            mockedRedis.incr.mockResolvedValue(5);
            const limiter = (0, rateLimiter_1.createPlanRateLimiter)();
            await limiter(req, res, next);
            expect(next).toHaveBeenCalled();
        });
    });
    describe('error handling', () => {
        test('fails open if Redis is down', async () => {
            ;
            prisma_1.default.user.findUnique.mockResolvedValue({
                id: 'user-123',
                plan: 'FREE',
            });
            mockedRedis.incr.mockRejectedValue(new Error('Redis down'));
            const limiter = (0, rateLimiter_1.createPlanRateLimiter)();
            await limiter(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
        test('returns 404 if user not found', async () => {
            ;
            prisma_1.default.user.findUnique.mockResolvedValue(null);
            const limiter = (0, rateLimiter_1.createPlanRateLimiter)();
            await limiter(req, res, next);
            expect(res.status).toHaveBeenCalledWith(404);
        });
        test('skips if Redis not connected', async () => {
            mockedRedis.isOpen = false;
            const limiter = (0, rateLimiter_1.createPlanRateLimiter)();
            await limiter(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(mockedRedis.incr).not.toHaveBeenCalled();
        });
    });
});
