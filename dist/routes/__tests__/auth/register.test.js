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
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const emailService_1 = require("../../../services/emailService");
const refreshToken_1 = require("../../../utils/refreshToken");
const getUserIp_1 = require("../../../utils/getUserIp");
const sanitizeInput_1 = require("../../../utils/sanitizeInput");
jest.mock('../../../lib/prisma', () => ({
    __esModule: true,
    default: {
        user: {
            findUnique: jest.fn(),
            create: jest.fn(),
        },
    },
}));
jest.mock('bcrypt');
jest.mock('jsonwebtoken');
jest.mock('../../../services/emailService');
jest.mock('../../../utils/refreshToken');
jest.mock('../../../utils/getUserIp');
jest.mock('../../../utils/sanitizeInput');
jest.mock('../../../utils/setAuthCookie');
jest.mock('../../../lib/logger', () => ({
    logger: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
    },
}));
jest.mock('../../../middleware/rateLimiter', () => ({
    authLimiter: (req, res, next) => next(),
    forgotPasswordLimiter: (req, res, next) => next(),
}));
describe('POST /register', () => {
    let app;
    beforeEach(() => {
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/auth', auth_routes_1.default);
        jest.clearAllMocks();
        sanitizeInput_1.sanitizeInput.mockImplementation((val) => val);
        getUserIp_1.getUserIp.mockReturnValue('127.0.0.1');
    });
    it('should register a new user successfully', async () => {
        const mockUser = {
            id: '123',
            email: 'test@example.com',
            name: 'Test User',
            credits: 10,
            avatar: null,
            passwordHash: 'hashed',
        };
        prisma_1.default.user.findUnique.mockResolvedValue(null);
        bcrypt_1.default.hash.mockResolvedValue('hashedPassword');
        prisma_1.default.user.create.mockResolvedValue(mockUser);
        jsonwebtoken_1.default.sign.mockReturnValue('accessToken');
        refreshToken_1.createRefreshToken.mockResolvedValue('refreshToken');
        emailService_1.sendWelcomeEmail.mockResolvedValue(undefined);
        const response = await (0, supertest_1.default)(app).post('/api/auth/register').send({
            email: 'test@example.com',
            password: 'password123',
            name: 'Test User',
            agreedToTerms: true,
        });
        expect(response.status).toBe(201);
        expect(response.body.user).toEqual({
            id: '123',
            email: 'test@example.com',
            name: 'Test User',
            credits: 10,
            avatar: null,
        });
        expect(emailService_1.sendWelcomeEmail).toHaveBeenCalledWith('test@example.com', 'Test User');
    });
    it('should return 400 if required fields are missing', async () => {
        const response = await (0, supertest_1.default)(app).post('/api/auth/register').send({
            email: 'test@example.com',
            password: 'password123',
        });
        expect(response.status).toBe(400);
    });
    it('should return 400 if email format is invalid', async () => {
        const response = await (0, supertest_1.default)(app).post('/api/auth/register').send({
            email: 'invalid-email',
            password: 'password123',
            name: 'Test User',
            agreedToTerms: true,
        });
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid email format');
    });
    it('should return 400 if password is less than 8 characters', async () => {
        const response = await (0, supertest_1.default)(app).post('/api/auth/register').send({
            email: 'test@example.com',
            password: 'pass',
            name: 'Test User',
            agreedToTerms: true,
        });
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Password must be at least 8 characters');
    });
    it('should return 400 if email is too long', async () => {
        const longEmail = 'a'.repeat(250) + '@example.com'; // Over 254 chars
        const response = await (0, supertest_1.default)(app).post('/api/auth/register').send({
            email: longEmail,
            password: 'password123',
            name: 'Test User',
            agreedToTerms: true,
        });
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Email is too long (max 254 characters)');
    });
    it('should return 400 if password is too long', async () => {
        const longPassword = 'a'.repeat(130); // Over 128 chars
        const response = await (0, supertest_1.default)(app).post('/api/auth/register').send({
            email: 'test@example.com',
            password: longPassword,
            name: 'Test User',
            agreedToTerms: true,
        });
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Password is too long (max 128 characters)');
    });
    it('should return 400 if name is too long', async () => {
        const longName = 'a'.repeat(101); // Over 100 chars
        const response = await (0, supertest_1.default)(app).post('/api/auth/register').send({
            email: 'test@example.com',
            password: 'password123',
            name: longName,
            agreedToTerms: true,
        });
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Name is too long (max 100 characters)');
    });
    it('should return 400 if terms are not agreed', async () => {
        const response = await (0, supertest_1.default)(app).post('/api/auth/register').send({
            email: 'test@example.com',
            password: 'password123',
            name: 'Test User',
            agreedToTerms: false,
        });
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Terms of Service');
    });
    it('should return 400 if email already exists', async () => {
        ;
        prisma_1.default.user.findUnique.mockResolvedValue({
            id: '123',
            email: 'test@example.com',
        });
        const response = await (0, supertest_1.default)(app).post('/api/auth/register').send({
            email: 'test@example.com',
            password: 'password123',
            name: 'Test User',
            agreedToTerms: true,
        });
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Email is invalid or already taken');
    });
    it('should return 500 if an error occurs', async () => {
        ;
        prisma_1.default.user.findUnique.mockRejectedValue(new Error('Database error'));
        const response = await (0, supertest_1.default)(app).post('/api/auth/register').send({
            email: 'test@example.com',
            password: 'password123',
            name: 'Test User',
            agreedToTerms: true,
        });
        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Internal server error');
    });
    it('should sanitize and lowercase email', async () => {
        ;
        sanitizeInput_1.sanitizeInput.mockImplementation((val) => val.trim());
        prisma_1.default.user.findUnique.mockResolvedValue(null);
        bcrypt_1.default.hash.mockResolvedValue('hashedPassword');
        prisma_1.default.user.create.mockResolvedValue({
            id: '123',
            email: 'test@example.com',
            name: 'Test User',
            credits: 10,
        });
        jsonwebtoken_1.default.sign.mockReturnValue('token');
        refreshToken_1.createRefreshToken.mockResolvedValue('refreshToken');
        emailService_1.sendWelcomeEmail.mockResolvedValue(undefined);
        await (0, supertest_1.default)(app).post('/api/auth/register').send({
            email: '  TEST@EXAMPLE.COM  ',
            password: 'password123',
            name: '  Test User  ',
            agreedToTerms: true,
        });
        expect(sanitizeInput_1.sanitizeInput).toHaveBeenCalledWith('  test@example.com  ');
        expect(sanitizeInput_1.sanitizeInput).toHaveBeenCalledWith('  Test User  ');
    });
});
