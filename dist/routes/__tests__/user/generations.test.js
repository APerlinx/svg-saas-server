"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('../../../lib/prisma', () => ({
    __esModule: true,
    default: {
        svgGeneration: {
            findMany: jest.fn(),
        },
    },
}));
jest.mock('../../../middleware/auth', () => ({
    authMiddleware: jest.fn((req, res, next) => {
        req.user = { userId: 'user-123' };
        next();
    }),
}));
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const prisma_1 = __importDefault(require("../../../lib/prisma"));
let app;
beforeAll(async () => {
    const routerModule = await import('../../user.routes.js');
    const router = routerModule.default;
    app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/user', router);
});
describe('GET /generations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should return first page with nextCursor when more results exist', async () => {
        ;
        prisma_1.default.svgGeneration.findMany.mockResolvedValue([
            {
                id: 'g3',
                prompt: 'p3',
                style: 'flat',
                model: 'gpt-4o',
                privacy: true,
                creditsUsed: 1,
                createdAt: new Date('2025-12-26T10:00:00Z'),
            },
            {
                id: 'g2',
                prompt: 'p2',
                style: 'flat',
                model: 'gpt-4o',
                privacy: false,
                creditsUsed: 1,
                createdAt: new Date('2025-12-26T09:00:00Z'),
            },
            {
                id: 'g1',
                prompt: 'p1',
                style: 'flat',
                model: 'gpt-4o',
                privacy: false,
                creditsUsed: 1,
                createdAt: new Date('2025-12-26T08:00:00Z'),
            },
        ]);
        const res = await (0, supertest_1.default)(app).get('/api/user/generations?limit=2');
        expect(res.status).toBe(200);
        expect(res.body.generations).toHaveLength(2);
        expect(res.body.nextCursor).toBe('g2');
        expect(prisma_1.default.svgGeneration.findMany).toHaveBeenCalledWith({
            where: { userId: 'user-123' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 3,
            select: expect.any(Object),
        });
    });
    it('should treat empty cursor as first page (no cursor passed to prisma)', async () => {
        ;
        prisma_1.default.svgGeneration.findMany.mockResolvedValue([]);
        const res = await (0, supertest_1.default)(app).get('/api/user/generations?cursor=&limit=2');
        expect(res.status).toBe(200);
        expect(prisma_1.default.svgGeneration.findMany).toHaveBeenCalledWith({
            where: { userId: 'user-123' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 3,
            select: expect.any(Object),
        });
    });
    it('should fetch next page when cursor is provided', async () => {
        ;
        prisma_1.default.svgGeneration.findMany.mockResolvedValue([
            {
                id: 'g1',
                prompt: 'p1',
                style: 'flat',
                model: 'gpt-4o',
                privacy: false,
                creditsUsed: 1,
                createdAt: new Date('2025-12-26T08:00:00Z'),
            },
        ]);
        const res = await (0, supertest_1.default)(app).get('/api/user/generations?limit=2&cursor=g2');
        expect(res.status).toBe(200);
        expect(res.body.generations).toHaveLength(1);
        expect(prisma_1.default.svgGeneration.findMany).toHaveBeenCalledWith({
            where: { userId: 'user-123' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 3,
            cursor: { id: 'g2' },
            skip: 1,
            select: expect.any(Object),
        });
    });
    it('should filter by privacy=public', async () => {
        ;
        prisma_1.default.svgGeneration.findMany.mockResolvedValue([]);
        const res = await (0, supertest_1.default)(app).get('/api/user/generations?privacy=public');
        expect(res.status).toBe(200);
        expect(prisma_1.default.svgGeneration.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId: 'user-123', privacy: false },
        }));
    });
    it('should filter by privacy=private', async () => {
        ;
        prisma_1.default.svgGeneration.findMany.mockResolvedValue([]);
        const res = await (0, supertest_1.default)(app).get('/api/user/generations?privacy=private');
        expect(res.status).toBe(200);
        expect(prisma_1.default.svgGeneration.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId: 'user-123', privacy: true },
        }));
    });
    it('should return 400 for invalid style', async () => {
        const res = await (0, supertest_1.default)(app).get('/api/user/generations?style=not-a-style');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid style/i);
        expect(prisma_1.default.svgGeneration.findMany).not.toHaveBeenCalled();
    });
    it('should return 400 for invalid model', async () => {
        const res = await (0, supertest_1.default)(app).get('/api/user/generations?model=not-a-model');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid model/i);
        expect(prisma_1.default.svgGeneration.findMany).not.toHaveBeenCalled();
    });
    it('should return 400 for invalid privacy', async () => {
        const res = await (0, supertest_1.default)(app).get('/api/user/generations?privacy=hacked');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid privacy/i);
        expect(res.body.errorCode).toBe('INVALID_PRIVACY');
        expect(prisma_1.default.svgGeneration.findMany).not.toHaveBeenCalled();
    });
});
