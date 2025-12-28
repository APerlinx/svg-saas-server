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
        generationJob: {
            findFirst: jest.fn(),
            create: jest.fn(),
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
jest.mock('../../../middleware/auth', () => ({
    __esModule: true,
    authMiddleware: (req, res, next) => {
        req.user = { id: 'user1' };
        next();
    },
    optionalAuthMiddleware: (req, res, next) => next(),
    svgGenerationLimiter: (req, res, next) => next(),
    dailyGenerationLimit: () => (req, res, next) => next(),
}));
jest.mock('../../../utils/getUserId', () => ({
    __esModule: true,
    requireUserId: (req) => req.user.id,
    getUserId: (req) => { var _a; return (_a = req.user) === null || _a === void 0 ? void 0 : _a.id; },
}));
jest.mock('../../../utils/sanitizeInput', () => ({
    __esModule: true,
    sanitizeInput: (input) => input,
}));
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const prisma_1 = __importDefault(require("../../../lib/prisma"));
const svgStyles_1 = require("../../../constants/svgStyles");
const models_1 = require("../../../constants/models");
const computeRequestHash_1 = require("../../../utils/computeRequestHash");
const svgGenerationQueue_1 = require("../../../jobs/svgGenerationQueue");
let app;
const basePrompt = 'A valid prompt for SVG generation';
const baseStyle = svgStyles_1.VALID_SVG_STYLES[0];
const baseModel = models_1.DEFAULT_MODEL;
const basePrivacy = false;
const baseRequestHash = (0, computeRequestHash_1.computeRequestHash)({
    prompt: basePrompt,
    style: baseStyle,
    model: baseModel,
    privacy: basePrivacy,
});
const baseJob = {
    id: 'job-123',
    userId: 'user1',
    prompt: basePrompt,
    style: baseStyle,
    model: baseModel,
    privacy: basePrivacy,
    status: 'QUEUED',
    createdAt: new Date('2025-12-25T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
    generationId: null,
    generation: null,
    requestHash: baseRequestHash,
};
beforeAll(async () => {
    const routerModule = await Promise.resolve().then(() => __importStar(require('../../svg.routes')));
    const router = routerModule.default;
    app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/svg', router);
});
describe('POST /generate-svg', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        svgGenerationQueue_1.svgGenerationQueue.getJobCounts.mockResolvedValue({
            waiting: 0,
            delayed: 0,
            active: 0,
        });
        prisma_1.default.generationJob.create.mockResolvedValue({
            ...baseJob,
        });
        prisma_1.default.generationJob.findFirst.mockResolvedValue(null);
    });
    it('should return 400 if prompt is missing', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/svg/generate-svg')
            .send({ style: svgStyles_1.VALID_SVG_STYLES[0] });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Prompt is required/);
    });
    it('should return 400 if prompt is too short', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/svg/generate-svg')
            .send({ prompt: 'short', style: svgStyles_1.VALID_SVG_STYLES[0] });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Prompt length must be between/);
    });
    it('should return 400 if prompt contains forbidden content', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/svg/generate-svg')
            .send({ prompt: '<script>alert(1)</script>', style: svgStyles_1.VALID_SVG_STYLES[0] });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/forbidden content/);
    });
    it('should return 400 if style is invalid', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/svg/generate-svg')
            .send({ prompt: 'A valid prompt for SVG', style: 'invalid-style' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid style/);
    });
    it('should return 400 if model is invalid', async () => {
        const res = await (0, supertest_1.default)(app).post('/api/svg/generate-svg').send({
            prompt: 'A valid prompt for SVG',
            style: svgStyles_1.VALID_SVG_STYLES[0],
            model: 'invalid-model',
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid model/);
    });
    it('should enqueue a generation job and return 202 with queue metadata', async () => {
        const res = await (0, supertest_1.default)(app).post('/api/svg/generate-svg').send({
            prompt: basePrompt,
            style: baseStyle,
        });
        expect(res.status).toBe(202);
        expect(res.body.job.id).toBe('job-123');
        expect(prisma_1.default.generationJob.create).toHaveBeenCalledWith({
            data: {
                userId: 'user1',
                prompt: basePrompt,
                style: baseStyle,
                model: baseModel,
                privacy: basePrivacy,
                idempotencyKey: null,
                requestHash: expect.any(String),
            },
            select: expect.objectContaining({
                id: true,
                userId: true,
                prompt: true,
                style: true,
                model: true,
                privacy: true,
                status: true,
                requestHash: true,
                generation: expect.objectContaining({
                    select: expect.objectContaining({
                        id: true,
                        prompt: true,
                        style: true,
                        model: true,
                        svg: true,
                        privacy: true,
                        createdAt: true,
                    }),
                }),
            }),
        });
        expect(svgGenerationQueue_1.enqueueSvgGenerationJob).toHaveBeenCalledWith('job-123');
        expect(svgGenerationQueue_1.svgGenerationQueue.getJobCounts).toHaveBeenCalled();
        expect(res.headers.location).toContain('/api/svg/generation-jobs/job-123');
    });
    it('should reuse an existing job when idempotency key matches', async () => {
        ;
        prisma_1.default.generationJob.findFirst.mockResolvedValue({
            ...baseJob,
            id: 'job-existing',
        });
        const res = await (0, supertest_1.default)(app)
            .post('/api/svg/generate-svg')
            .set('x-idempotency-key', '1234')
            .send({
            prompt: basePrompt,
            style: baseStyle,
        });
        expect(res.status).toBe(202);
        expect(res.body.job.id).toBe('job-existing');
        expect(prisma_1.default.generationJob.create).not.toHaveBeenCalled();
        expect(svgGenerationQueue_1.enqueueSvgGenerationJob).not.toHaveBeenCalled();
    });
    it('should reject overly long idempotency keys', async () => {
        const longKey = 'x'.repeat(129);
        const res = await (0, supertest_1.default)(app)
            .post('/api/svg/generate-svg')
            .set('x-idempotency-key', longKey)
            .send({
            prompt: 'A valid prompt for SVG generation',
            style: svgStyles_1.VALID_SVG_STYLES[0],
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Idempotency key/i);
        expect(prisma_1.default.generationJob.create).not.toHaveBeenCalled();
    });
    it('should handle internal server error', async () => {
        ;
        prisma_1.default.generationJob.create.mockRejectedValue(new Error('DB error'));
        const res = await (0, supertest_1.default)(app).post('/api/svg/generate-svg').send({
            prompt: 'A valid prompt for SVG generation',
            style: svgStyles_1.VALID_SVG_STYLES[0],
        });
        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/Internal server error/);
    });
});
