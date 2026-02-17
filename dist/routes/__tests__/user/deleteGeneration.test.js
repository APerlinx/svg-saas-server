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
            findFirst: jest.fn(),
            deleteMany: jest.fn(),
        },
    },
}));
jest.mock('../../../middleware/auth', () => ({
    authMiddleware: jest.fn((req, res, next) => {
        req.user = { userId: 'user-123' };
        next();
    }),
}));
jest.mock('../../../lib/s3', () => ({
    deleteSvg: jest.fn(),
}));
jest.mock('@sentry/node', () => ({
    captureException: jest.fn(),
    captureMessage: jest.fn(),
}));
jest.mock('../../../config/env', () => ({
    IS_PRODUCTION: true,
    IS_S3_ENABLED: true,
    PUBLIC_ASSETS_BASE_URL: 'https://cdn.example.com',
}));
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const prisma_1 = __importDefault(require("../../../lib/prisma"));
const s3_1 = require("../../../lib/s3");
const Sentry = __importStar(require("@sentry/node"));
let app;
beforeAll(async () => {
    const routerModule = await import('../../user.routes.js');
    const router = routerModule.default;
    app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/user', router);
});
describe('DELETE /api/user/generations/:id', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.SENTRY_DSN = 'test-dsn';
    });
    afterEach(() => {
        delete process.env.SENTRY_DSN;
    });
    it('deletes DB first, then deletes from S3', async () => {
        ;
        prisma_1.default.svgGeneration.findFirst.mockResolvedValue({
            s3Key: 'k.svg',
        });
        prisma_1.default.svgGeneration.deleteMany.mockResolvedValue({
            count: 1,
        });
        s3_1.deleteSvg.mockResolvedValue(undefined);
        const res = await (0, supertest_1.default)(app).delete('/api/user/generations/gen_1');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true });
        expect(prisma_1.default.svgGeneration.findFirst).toHaveBeenCalledWith({
            where: { id: 'gen_1', userId: 'user-123' },
            select: { s3Key: true },
        });
        expect(prisma_1.default.svgGeneration.deleteMany).toHaveBeenCalledWith({
            where: { id: 'gen_1', userId: 'user-123' },
        });
        expect(s3_1.deleteSvg).toHaveBeenCalledWith('k.svg');
        const findOrder = prisma_1.default.svgGeneration.findFirst.mock
            .invocationCallOrder[0];
        const deleteDbOrder = prisma_1.default.svgGeneration.deleteMany.mock
            .invocationCallOrder[0];
        const deleteS3Order = s3_1.deleteSvg.mock.invocationCallOrder[0];
        expect(findOrder).toBeLessThan(deleteDbOrder);
        expect(deleteDbOrder).toBeLessThan(deleteS3Order);
    });
    it('returns 404 if generation not found (no DB delete, no S3 delete)', async () => {
        ;
        prisma_1.default.svgGeneration.findFirst.mockResolvedValue(null);
        const res = await (0, supertest_1.default)(app).delete('/api/user/generations/missing');
        expect(res.status).toBe(404);
        expect(prisma_1.default.svgGeneration.deleteMany).not.toHaveBeenCalled();
        expect(s3_1.deleteSvg).not.toHaveBeenCalled();
    });
    it('returns 404 if deleteMany count is 0 and reports to Sentry', async () => {
        ;
        prisma_1.default.svgGeneration.findFirst.mockResolvedValue({
            s3Key: 'k.svg',
        });
        prisma_1.default.svgGeneration.deleteMany.mockResolvedValue({
            count: 0,
        });
        const res = await (0, supertest_1.default)(app).delete('/api/user/generations/gen_1');
        expect(res.status).toBe(404);
        expect(s3_1.deleteSvg).not.toHaveBeenCalled();
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    });
    it('succeeds even if S3 delete fails, and reports to Sentry', async () => {
        ;
        prisma_1.default.svgGeneration.findFirst.mockResolvedValue({
            s3Key: 'k.svg',
        });
        prisma_1.default.svgGeneration.deleteMany.mockResolvedValue({
            count: 1,
        });
        s3_1.deleteSvg.mockRejectedValue(new Error('S3 down'));
        const res = await (0, supertest_1.default)(app).delete('/api/user/generations/gen_1');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true });
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });
});
