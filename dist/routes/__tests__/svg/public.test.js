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
jest.mock('../../../lib/prisma', () => ({
    __esModule: true,
    default: {
        svgGeneration: {
            count: jest.fn(),
            findMany: jest.fn(),
        },
    },
}));
jest.mock('../../../jobs/svgGenerationQueue', () => ({
    __esModule: true,
    enqueueSvgGenerationJob: jest.fn(),
    svgGenerationQueue: {
        getJobCounts: jest.fn(),
    },
}));
jest.mock('../../../lib/cache', () => ({
    cache: {
        getOrSetJson: jest.fn(),
        buildKey: jest.fn((...parts) => parts.join(':')),
        del: jest.fn(),
    },
}));
jest.mock('../../../utils/sanitizeSvg', () => ({
    sanitizeSvg: jest.fn((svg) => svg),
}));
jest.mock('../../../services/aiService', () => ({
    generateSvg: jest.fn(),
}));
jest.mock('../../../middleware/rateLimiter', () => ({
    svgGenerationLimiter: jest.fn((req, res, next) => next()),
    authLimiter: jest.fn((req, res, next) => next()),
    apiLimiter: jest.fn((req, res, next) => next()),
    forgotPasswordLimiter: jest.fn((req, res, next) => next()),
}));
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const prisma_1 = __importDefault(require("../../../lib/prisma"));
const cache_1 = require("../../../lib/cache");
let app;
beforeAll(async () => {
    const routerModule = await Promise.resolve().then(() => __importStar(require('../../svg.routes')));
    const router = routerModule.default;
    app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/svg', router);
});
describe('GET /public', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should return paginated public SVGs from cache', async () => {
        const mockPublicGenerations = [
            {
                id: 'svg1',
                prompt: 'A beautiful sunset',
                style: 'flat',
                model: 'gpt-4o',
                privacy: false,
                creditsUsed: 5,
                createdAt: new Date('2025-12-26T10:00:00Z'),
            },
            {
                id: 'svg2',
                prompt: 'A cute cat',
                style: 'lineart',
                model: 'gpt-4o',
                privacy: false,
                creditsUsed: 5,
                createdAt: new Date('2025-12-26T09:00:00Z'),
            },
        ];
        const cachedData = {
            publicGenerations: mockPublicGenerations,
            totalCount: 2,
            totalPages: 1,
            hasMore: false,
            page: 1,
            limit: 10,
        };
        cache_1.cache.getOrSetJson.mockResolvedValue(cachedData);
        const res = await (0, supertest_1.default)(app).get('/api/svg/public');
        expect(res.status).toBe(200);
        expect(res.body.publicGenerations).toHaveLength(2);
        expect(res.body.publicGenerations[0].prompt).toBe('A beautiful sunset');
        expect(res.body.pagination).toEqual({
            currentPage: 1,
            totalPages: 1,
            totalCount: 2,
            limit: 10,
            hasMore: false,
        });
        expect(cache_1.cache.buildKey).toHaveBeenCalledWith('public', 'page', 1, 'limit', 10);
        expect(cache_1.cache.getOrSetJson).toHaveBeenCalled();
    });
    it('should handle pagination parameters', async () => {
        const cachedData = {
            publicGenerations: [],
            totalCount: 25,
            totalPages: 3,
            hasMore: true,
            page: 2,
            limit: 10,
        };
        cache_1.cache.getOrSetJson.mockResolvedValue(cachedData);
        const res = await (0, supertest_1.default)(app).get('/api/svg/public?page=2&limit=10');
        expect(res.status).toBe(200);
        expect(res.body.pagination.currentPage).toBe(2);
        expect(res.body.pagination.totalPages).toBe(3);
        expect(res.body.pagination.hasMore).toBe(true);
        expect(cache_1.cache.buildKey).toHaveBeenCalledWith('public', 'page', 2, 'limit', 10);
    });
    it('should fetch from database when cache misses', async () => {
        const mockPublicGenerations = [
            {
                id: 'svg1',
                prompt: 'A test prompt',
                style: 'flat',
                model: 'gpt-4o',
                privacy: false,
                creditsUsed: 5,
                createdAt: new Date('2025-12-26T10:00:00Z'),
            },
        ];
        cache_1.cache.getOrSetJson.mockImplementation(async (key, fetcher) => {
            return await fetcher();
        });
        prisma_1.default.svgGeneration.count.mockResolvedValue(1);
        prisma_1.default.svgGeneration.findMany.mockResolvedValue(mockPublicGenerations);
        const res = await (0, supertest_1.default)(app).get('/api/svg/public');
        expect(res.status).toBe(200);
        expect(res.body.publicGenerations).toHaveLength(1);
        expect(prisma_1.default.svgGeneration.count).toHaveBeenCalledWith({
            where: { privacy: false },
        });
        expect(prisma_1.default.svgGeneration.findMany).toHaveBeenCalledWith({
            where: { privacy: false },
            orderBy: { createdAt: 'desc' },
            skip: 0,
            take: 10,
            select: expect.any(Object),
        });
    });
    it('should return empty array when no public SVGs exist', async () => {
        const cachedData = {
            publicGenerations: [],
            totalCount: 0,
            totalPages: 0,
            hasMore: false,
            page: 1,
            limit: 10,
        };
        cache_1.cache.getOrSetJson.mockResolvedValue(cachedData);
        const res = await (0, supertest_1.default)(app).get('/api/svg/public');
        expect(res.status).toBe(200);
        expect(res.body.publicGenerations).toEqual([]);
        expect(res.body.pagination.totalCount).toBe(0);
    });
    it('should return 500 on database error', async () => {
        ;
        cache_1.cache.getOrSetJson.mockRejectedValue(new Error('Database error'));
        const res = await (0, supertest_1.default)(app).get('/api/svg/public');
        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Internal server error');
    });
    it('should use default pagination values when not provided', async () => {
        const cachedData = {
            publicGenerations: [],
            totalCount: 0,
            totalPages: 0,
            hasMore: false,
            page: 1,
            limit: 10,
        };
        cache_1.cache.getOrSetJson.mockResolvedValue(cachedData);
        const res = await (0, supertest_1.default)(app).get('/api/svg/public');
        expect(res.status).toBe(200);
        expect(cache_1.cache.buildKey).toHaveBeenCalledWith('public', 'page', 1, 'limit', 10);
    });
});
