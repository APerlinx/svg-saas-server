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
describe('DELETE /api/keys/:id - Revoke API Key', () => {
    const { revokeApiKey } = require('../../../services/apiKeyService');
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should return 404 if API key not found', async () => {
        revokeApiKey.mockResolvedValue(false);
        const res = await (0, supertest_1.default)(app).delete('/api/keys/key-123');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('API key not found or already revoked');
    });
    it('should revoke API key successfully', async () => {
        revokeApiKey.mockResolvedValue(true);
        const res = await (0, supertest_1.default)(app).delete('/api/keys/key-123');
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('API key revoked successfully');
        expect(revokeApiKey).toHaveBeenCalledWith('key-123', 'user-123');
    });
    it('should return 500 if service throws error', async () => {
        revokeApiKey.mockRejectedValue(new Error('Database error'));
        const res = await (0, supertest_1.default)(app).delete('/api/keys/key-123');
        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to revoke API key');
    });
});
