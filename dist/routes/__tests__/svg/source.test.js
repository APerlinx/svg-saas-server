"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('../../../lib/prisma', () => ({
    __esModule: true,
    default: {
        svgGeneration: {
            findUnique: jest.fn(),
        },
    },
}));
jest.mock('../../../middleware/auth', () => ({
    authMiddleware: jest.fn((req, res, next) => next()),
    optionalAuthMiddleware: jest.fn((req, res, next) => next()),
}));
jest.mock('../../../lib/s3', () => ({
    __esModule: true,
    getDownloadUrl: jest.fn(),
    getSvgSourceFromS3: jest.fn(),
}));
jest.mock('../../../jobs/svgGenerationQueue', () => ({
    __esModule: true,
    enqueueSvgGenerationJob: jest.fn(),
    svgGenerationQueue: {
        getJobCounts: jest.fn(),
    },
}));
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const prisma_1 = __importDefault(require("../../../lib/prisma"));
const s3_1 = require("../../../lib/s3");
let app;
beforeAll(async () => {
    const routerModule = await import('../../svg.routes.js');
    const router = routerModule.default;
    app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/svg', router);
});
describe('GET /:id/source', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should return SVG source from S3 when s3Key exists', async () => {
        ;
        prisma_1.default.svgGeneration.findUnique.mockResolvedValue({
            id: 'g1',
            userId: 'u1',
            privacy: false,
            s3Key: 'users/u1/jobs/j1/chatsvg.svg',
            svg: null,
        });
        s3_1.getSvgSourceFromS3.mockResolvedValue('<svg>from-s3</svg>');
        const res = await (0, supertest_1.default)(app).get('/api/svg/g1/source');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ id: 'g1', svg: '<svg>from-s3</svg>' });
        expect(s3_1.getSvgSourceFromS3).toHaveBeenCalledWith('users/u1/jobs/j1/chatsvg.svg');
    });
    it('should fall back to DB svg when no s3Key', async () => {
        ;
        prisma_1.default.svgGeneration.findUnique.mockResolvedValue({
            id: 'g2',
            userId: 'u2',
            privacy: false,
            s3Key: null,
            svg: '<svg>from-db</svg>',
        });
        const res = await (0, supertest_1.default)(app).get('/api/svg/g2/source');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ id: 'g2', svg: '<svg>from-db</svg>' });
        expect(s3_1.getSvgSourceFromS3).not.toHaveBeenCalled();
    });
    it('should return 403 for private SVG when not owner', async () => {
        ;
        prisma_1.default.svgGeneration.findUnique.mockResolvedValue({
            id: 'g3',
            userId: 'u-owner',
            privacy: true,
            s3Key: 'k',
            svg: null,
        });
        const res = await (0, supertest_1.default)(app).get('/api/svg/g3/source');
        expect(res.status).toBe(403);
        expect(s3_1.getSvgSourceFromS3).not.toHaveBeenCalled();
    });
    it('should return 404 when not found', async () => {
        ;
        prisma_1.default.svgGeneration.findUnique.mockResolvedValue(null);
        const res = await (0, supertest_1.default)(app).get('/api/svg/missing/source');
        expect(res.status).toBe(404);
    });
    it('should return svg=null when no source is available', async () => {
        ;
        prisma_1.default.svgGeneration.findUnique.mockResolvedValue({
            id: 'g4',
            userId: 'u4',
            privacy: false,
            s3Key: null,
            svg: null,
        });
        const res = await (0, supertest_1.default)(app).get('/api/svg/g4/source');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ id: 'g4', svg: null });
        expect(s3_1.getSvgSourceFromS3).not.toHaveBeenCalled();
    });
});
