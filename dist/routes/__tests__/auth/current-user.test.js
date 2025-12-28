"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const auth_routes_1 = __importDefault(require("../../auth.routes"));
const prisma_1 = __importDefault(require("../../../lib/prisma"));
const getUserId_1 = require("../../../utils/getUserId");
// Mock dependencies
jest.mock('../../../lib/prisma', () => ({
    __esModule: true,
    default: {
        user: {
            findUnique: jest.fn(),
        },
    },
}));
jest.mock('../../../middleware/auth', () => ({
    authMiddleware: jest.fn((req, res, next) => next()),
}));
jest.mock('../../../utils/getUserId', () => ({
    requireUserId: jest.fn(),
}));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use('/api/auth', auth_routes_1.default);
describe('GET /current-user', () => {
    const mockUser = {
        id: 'user123',
        name: 'Test User',
        email: 'test@example.com',
        avatar: 'avatar.png',
        credits: 42,
    };
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should return 401 if userId is not present', async () => {
        ;
        getUserId_1.requireUserId.mockReturnValue(null);
        const res = await (0, supertest_1.default)(app).get('/api/auth/current-user');
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'Unauthorized' });
    });
    it('should return 404 if user not found', async () => {
        ;
        getUserId_1.requireUserId.mockReturnValue('user123');
        prisma_1.default.user.findUnique.mockResolvedValue(null);
        const res = await (0, supertest_1.default)(app).get('/api/auth/current-user');
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: 'User not found' });
    });
    it('should return user data if user is found', async () => {
        ;
        getUserId_1.requireUserId.mockReturnValue('user123');
        prisma_1.default.user.findUnique.mockResolvedValue(mockUser);
        const res = await (0, supertest_1.default)(app).get('/api/auth/current-user');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            id: mockUser.id,
            name: mockUser.name,
            email: mockUser.email,
            avatar: mockUser.avatar,
            credits: mockUser.credits,
        });
    });
    it('should default credits to 0 if undefined', async () => {
        ;
        getUserId_1.requireUserId.mockReturnValue('user123');
        prisma_1.default.user.findUnique.mockResolvedValue({
            ...mockUser,
            credits: undefined,
        });
        const res = await (0, supertest_1.default)(app).get('/api/auth/current-user');
        expect(res.status).toBe(200);
        expect(res.body.credits).toBe(0);
    });
});
