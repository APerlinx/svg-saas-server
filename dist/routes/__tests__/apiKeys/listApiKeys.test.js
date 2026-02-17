"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const apiKeys_routes_1 = __importDefault(require("../../apiKeys.routes"));
// Mocks
jest.mock('../../../middleware/auth', () => ({
    authMiddleware: (req, res, next) => {
        req.user = { userId: 'user-123' };
        next();
    },
}));
jest.mock('../../../utils/getUserId', () => ({
    requireUserId: jest.fn((req) => req.user.userId),
}));
jest.mock('../../../services/apiKeyService', () => ({
    createApiKey: jest.fn(),
    getUserApiKeys: jest.fn(),
    revokeApiKey: jest.fn(),
    getApiKeyUsageStats: jest.fn(),
}));
jest.mock('../../../services/usageTrackingService', () => ({
    getUserUsageSummary: jest.fn(),
}));
jest.mock('../../../lib/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
    },
}));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use('/api/keys', apiKeys_routes_1.default);
describe('GET /api/keys - List API Keys', () => {
    const { getUserApiKeys } = require('../../../services/apiKeyService');
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should return empty array when user has no API keys', async () => {
        getUserApiKeys.mockResolvedValue([]);
        const res = await (0, supertest_1.default)(app).get('/api/keys');
        expect(res.status).toBe(200);
        expect(res.body.keys).toEqual([]);
    });
    it('should return list of API keys', async () => {
        const mockKeys = [
            {
                id: 'key-1',
                name: 'Production Key',
                keyPrefix: 'sk_prod_abc',
                environment: 'production',
                createdAt: new Date(),
                lastUsedAt: null,
                isRevoked: false,
            },
            {
                id: 'key-2',
                name: 'Test Key',
                keyPrefix: 'sk_test_xyz',
                environment: 'test',
                createdAt: new Date(),
                lastUsedAt: new Date(),
                isRevoked: false,
            },
        ];
        getUserApiKeys.mockResolvedValue(mockKeys);
        const res = await (0, supertest_1.default)(app).get('/api/keys');
        expect(res.status).toBe(200);
        expect(res.body.keys).toHaveLength(2);
        expect(res.body.keys[0].name).toBe('Production Key');
        expect(res.body.keys[1].name).toBe('Test Key');
    });
    it('should return 500 if service throws error', async () => {
        getUserApiKeys.mockRejectedValue(new Error('Database error'));
        const res = await (0, supertest_1.default)(app).get('/api/keys');
        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to retrieve API keys');
    });
});
