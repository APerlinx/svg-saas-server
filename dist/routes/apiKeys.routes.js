"use strict";
/**
 * API Key Management Routes
 * Internal endpoints for users to manage their API keys via web app
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const getUserId_1 = require("../utils/getUserId");
const apiKeyService_1 = require("../services/apiKeyService");
const usageTrackingService_1 = require("../services/usageTrackingService");
const logger_1 = require("../lib/logger");
const router = (0, express_1.Router)();
/**
 * POST /api/keys
 * Create a new API key
 */
router.post('/', auth_1.authMiddleware, async (req, res) => {
    var _a, _b;
    try {
        const userId = (0, getUserId_1.requireUserId)(req);
        const { name, description, environment, ipWhitelist, expiresAt } = req.body;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'Name is required' });
        }
        if (name.length > 100) {
            return res
                .status(400)
                .json({ error: 'Name must be 100 characters or less' });
        }
        const result = await (0, apiKeyService_1.createApiKey)({
            userId,
            name: name.trim(),
            description,
            environment: environment === 'test' ? 'test' : 'production',
            ipWhitelist: Array.isArray(ipWhitelist) ? ipWhitelist : undefined,
            expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        });
        logger_1.logger.info({ userId, apiKeyId: result.id, keyPrefix: result.keyPrefix }, 'API key created via web app');
        res.status(201).json({
            id: result.id,
            name: result.name,
            keyPrefix: result.keyPrefix,
            key: result.rawKey,
            createdAt: result.createdAt,
            warning: 'Save this key now. You will not be able to see it again.',
        });
    }
    catch (error) {
        // Enhanced error logging for debugging
        logger_1.logger.error({
            error: {
                message: error.message,
                stack: error.stack,
                code: error.code,
                name: error.name,
            },
            userId: (0, getUserId_1.requireUserId)(req),
            requestBody: req.body,
        }, 'Failed to create API key');
        if ((_a = error.message) === null || _a === void 0 ? void 0 : _a.includes('API access requires')) {
            return res.status(403).json({ error: error.message });
        }
        if ((_b = error.message) === null || _b === void 0 ? void 0 : _b.includes('Maximum API keys')) {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Failed to create API key' });
    }
});
/**
 * GET /api/keys
 * List all API keys for the authenticated user
 */
router.get('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = (0, getUserId_1.requireUserId)(req);
        const keys = await (0, apiKeyService_1.getUserApiKeys)(userId);
        res.json({ keys });
    }
    catch (error) {
        logger_1.logger.error({ error, userId: (0, getUserId_1.requireUserId)(req) }, 'Failed to list API keys');
        res.status(500).json({ error: 'Failed to retrieve API keys' });
    }
});
/**
 * DELETE /api/keys/:id
 * Revoke an API key
 */
router.delete('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = (0, getUserId_1.requireUserId)(req);
        const { id } = req.params;
        const success = await (0, apiKeyService_1.revokeApiKey)(id, userId);
        if (!success) {
            return res
                .status(404)
                .json({ error: 'API key not found or already revoked' });
        }
        res.json({ message: 'API key revoked successfully' });
    }
    catch (error) {
        logger_1.logger.error({ error, userId: (0, getUserId_1.requireUserId)(req), keyId: req.params.id }, 'Failed to revoke API key');
        res.status(500).json({ error: 'Failed to revoke API key' });
    }
});
/**
 * GET /api/keys/:id/stats
 * Get usage statistics for a specific API key
 */
router.get('/:id/stats', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = (0, getUserId_1.requireUserId)(req);
        const { id } = req.params;
        const stats = await (0, apiKeyService_1.getApiKeyUsageStats)(id, userId);
        res.json({ stats });
    }
    catch (error) {
        if (error.message === 'API key not found') {
            return res.status(404).json({ error: 'API key not found' });
        }
        logger_1.logger.error({ error, userId: (0, getUserId_1.requireUserId)(req), keyId: req.params.id }, 'Failed to get API key stats');
        res.status(500).json({ error: 'Failed to retrieve statistics' });
    }
});
/**
 * GET /api/keys/usage/summary
 * Get overall API usage summary for the user
 */
router.get('/usage/summary', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = (0, getUserId_1.requireUserId)(req);
        const { startDate, endDate } = req.query;
        const summary = await (0, usageTrackingService_1.getUserUsageSummary)(userId, startDate ? new Date(startDate) : undefined, endDate ? new Date(endDate) : undefined);
        res.json({ summary });
    }
    catch (error) {
        logger_1.logger.error({ error, userId: (0, getUserId_1.requireUserId)(req) }, 'Failed to get usage summary');
        res.status(500).json({ error: 'Failed to retrieve usage summary' });
    }
});
exports.default = router;
