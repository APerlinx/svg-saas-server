"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const support_routes_1 = __importDefault(require("../../support.routes"));
const emailService_1 = require("../../../services/emailService");
const prisma_1 = __importDefault(require("../../../lib/prisma"));
jest.mock('../../../services/emailService', () => ({
    sendSupportMessageEmail: jest.fn(),
    sendSupportConfirmationEmail: jest.fn(),
}));
jest.mock('../../../lib/prisma', () => ({
    __esModule: true,
    default: {
        user: {
            findUnique: jest.fn(),
        },
    },
}));
jest.mock('../../../middleware/rateLimiter', () => ({
    supportMessageLimiter: (req, res, next) => next(),
}));
jest.mock('../../../middleware/auth', () => ({
    optionalAuthMiddleware: (req, res, next) => {
        const userId = req.get('x-test-user-id');
        if (userId)
            req.user = { userId };
        next();
    },
}));
jest.mock('../../../utils/sanitizeInput', () => ({
    sanitizeInput: (input) => input.trim(),
}));
jest.mock('../../../utils/getUserIp', () => ({
    getUserIp: () => '1.2.3.4',
}));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use('/api/support', support_routes_1.default);
describe('POST /api/support/contact', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('returns 400 for invalid type', async () => {
        const res = await (0, supertest_1.default)(app).post('/api/support/contact').send({
            type: 'other',
            subject: 'Hello',
            message: 'World',
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid support message type');
    });
    it('returns 400 when subject/message missing', async () => {
        const res = await (0, supertest_1.default)(app).post('/api/support/contact').send({
            type: 'contact',
            subject: '',
            message: '',
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Subject and message are required');
    });
    it('returns 400 when logged out and email is missing', async () => {
        const res = await (0, supertest_1.default)(app).post('/api/support/contact').send({
            type: 'bug',
            subject: 'It broke',
            message: 'Steps to repro...',
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Email is required when not logged in');
        expect(emailService_1.sendSupportMessageEmail).not.toHaveBeenCalled();
    });
    it('sends internal email and confirmation when logged out', async () => {
        ;
        emailService_1.sendSupportMessageEmail.mockResolvedValue(undefined);
        emailService_1.sendSupportConfirmationEmail.mockResolvedValue(undefined);
        const res = await (0, supertest_1.default)(app).post('/api/support/contact').send({
            type: 'bug',
            subject: 'It broke',
            message: 'Steps to repro...',
            email: 'test@example.com',
        });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(emailService_1.sendSupportMessageEmail).toHaveBeenCalled();
        expect(emailService_1.sendSupportConfirmationEmail).toHaveBeenCalled();
    });
    it('uses DB email and still sends confirmation when logged in', async () => {
        ;
        emailService_1.sendSupportMessageEmail.mockResolvedValue(undefined);
        emailService_1.sendSupportConfirmationEmail.mockResolvedValue(undefined);
        prisma_1.default.user.findUnique.mockResolvedValue({
            email: 'authed@example.com',
        });
        const res = await (0, supertest_1.default)(app)
            .post('/api/support/contact')
            .set('x-test-user-id', 'user_123')
            .send({
            type: 'idea',
            subject: 'New feature',
            message: 'Please add ...',
        });
        expect(res.status).toBe(200);
        expect(emailService_1.sendSupportMessageEmail).toHaveBeenCalled();
        expect(emailService_1.sendSupportConfirmationEmail).toHaveBeenCalledWith('authed@example.com', 'idea', 'New feature');
    });
});
