"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const auth_routes_1 = __importDefault(require("../../auth.routes"));
const prisma_1 = __importDefault(require("../../../lib/prisma"));
const bcrypt_1 = __importDefault(require("bcrypt"));
jest.mock('../../../lib/prisma', () => ({
    __esModule: true,
    default: {
        user: {
            findFirst: jest.fn(),
            update: jest.fn(),
        },
    },
}));
jest.mock('bcrypt', () => ({
    hash: jest.fn(),
}));
jest.mock('../../../middleware/rateLimiter', () => ({
    authLimiter: (req, res, next) => next(),
    forgotPasswordLimiter: (req, res, next) => next(),
}));
jest.mock('../../../utils/sanitizeInput', () => ({
    sanitizeInput: (input) => input,
}));
jest.mock('../../../utils/createPasswordResetToken', () => ({
    hashResetToken: jest.fn((token) => `hashed_${token}`),
}));
jest.mock('../../../utils/refreshToken', () => ({
    revokeAllUserTokens: jest.fn(),
}));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use('/api/auth', auth_routes_1.default);
describe('POST /reset-password', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should return 400 if password is missing', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/reset-password')
            .send({ token: 'someToken' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing required fields');
    });
    it('should return 400 if password is too short', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/reset-password')
            .send({ token: 'someToken', newPassword: 'short' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Password must be at least 8 characters');
    });
    it('should return 400 if password is too long', async () => {
        const longPassword = 'a'.repeat(130);
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/reset-password')
            .send({ token: 'someToken', newPassword: longPassword });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Password is too long (max 128 characters)');
    });
    it('should return 400 if token is invalid or expired', async () => {
        ;
        prisma_1.default.user.findFirst.mockResolvedValue(null);
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/reset-password')
            .send({ token: 'invalidToken', newPassword: 'ValidPassword123' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid or expired reset token');
    });
    it('should reset password successfully with valid token', async () => {
        const mockUser = {
            id: '123',
            email: 'test@example.com',
            resetPasswordToken: 'hashed_validToken',
            resetPasswordExpires: new Date(Date.now() + 3600000), // 1 hour from now
        };
        prisma_1.default.user.findFirst.mockResolvedValue(mockUser);
        bcrypt_1.default.hash.mockResolvedValue('hashedNewPassword');
        prisma_1.default.user.update.mockResolvedValue({
            ...mockUser,
            password: 'hashedNewPassword',
            resetPasswordToken: null,
            resetPasswordExpires: null,
        });
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/reset-password')
            .send({ token: 'validToken', newPassword: 'NewPassword123' });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Password has been reset successfully. Please log in again.');
        expect(prisma_1.default.user.update).toHaveBeenCalledWith({
            where: { id: '123' },
            data: {
                passwordHash: 'hashedNewPassword',
                resetPasswordToken: null,
                resetPasswordExpires: null,
            },
        });
    });
});
