"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const auth_routes_1 = __importDefault(require("../../auth.routes"));
const prisma_1 = __importDefault(require("../../../lib/prisma"));
const emailService_1 = require("../../../services/emailService");
jest.mock('../../../lib/prisma', () => ({
    __esModule: true,
    default: {
        user: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    },
}));
jest.mock('../../../services/emailService', () => ({
    sendPasswordResetEmail: jest.fn(),
}));
jest.mock('../../../middleware/rateLimiter', () => ({
    authLimiter: (req, res, next) => next(),
    forgotPasswordLimiter: (req, res, next) => next(),
}));
jest.mock('../../../utils/sanitizeInput', () => ({
    sanitizeInput: (input) => input,
}));
jest.mock('../../../utils/createPasswordResetToken', () => ({
    createPasswordResetToken: jest.fn(() => ({
        resetToken: 'mockToken',
        hashedToken: 'mockHashedToken',
        resetExpires: new Date(),
    })),
    hashResetToken: jest.fn(),
}));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use('/api/auth', auth_routes_1.default);
describe('POST /forgot-password', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should return 400 if email is missing', async () => {
        const res = await (0, supertest_1.default)(app).post('/api/auth/forgot-password').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Email is required');
    });
    it('should return 400 if email format is invalid', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/forgot-password')
            .send({ email: 'invalid-email' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid email format');
    });
    it('should return 400 if email is too long', async () => {
        const longEmail = 'a'.repeat(250) + '@example.com';
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/forgot-password')
            .send({ email: longEmail });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Email is too long (max 254 characters)');
    });
    it('should return 200 even if user not found (security)', async () => {
        ;
        prisma_1.default.user.findUnique.mockResolvedValue(null);
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/forgot-password')
            .send({ email: 'notfound@example.com' });
        expect(res.status).toBe(200);
        expect(res.body.message).toContain('If that email is registered');
    });
    it('should send reset email for valid user', async () => {
        const mockUser = { id: '123', email: 'test@example.com' };
        prisma_1.default.user.findUnique.mockResolvedValue(mockUser);
        prisma_1.default.user.update.mockResolvedValue(mockUser);
        emailService_1.sendPasswordResetEmail.mockResolvedValue(undefined);
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/forgot-password')
            .send({ email: 'test@example.com' });
        expect(res.status).toBe(200);
        expect(prisma_1.default.user.update).toHaveBeenCalled();
        expect(emailService_1.sendPasswordResetEmail).toHaveBeenCalledWith('test@example.com', 'mockToken');
    });
});
