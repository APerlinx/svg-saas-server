"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdminOrAPIKey = exports.requireAdmin = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const logger_1 = require("../lib/logger");
const requireAdmin = (req, res, next) => {
    var _a;
    try {
        const adminToken = (_a = req.cookies) === null || _a === void 0 ? void 0 : _a['admin_session'];
        if (!adminToken) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Admin authentication required',
            });
        }
        // Verify JWT token
        const decoded = jsonwebtoken_1.default.verify(adminToken, env_1.JWT_SECRET);
        if (decoded.type !== 'admin' || decoded.email !== env_1.ADMIN_EMAIL) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Invalid admin credentials',
            });
        }
        // Token is valid, proceed
        next();
    }
    catch (error) {
        logger_1.logger.warn({ error }, 'Admin authentication failed');
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid or expired admin session',
        });
    }
};
exports.requireAdmin = requireAdmin;
const requireAdminOrAPIKey = (req, res, next) => {
    try {
        // Check for API key first (for n8n/automation)
        const apiKey = req.headers['x-admin-api-key'];
        if (apiKey && typeof apiKey === 'string') {
            const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
            if (!ADMIN_API_KEY) {
                logger_1.logger.error('ADMIN_API_KEY not configured');
                return res.status(500).json({ error: 'Server misconfiguration' });
            }
            if (apiKey === ADMIN_API_KEY) {
                // Valid API key, proceed
                return next();
            }
            else {
                logger_1.logger.warn({ ip: req.ip }, 'Invalid admin API key attempt');
                return res.status(403).json({ error: 'Invalid API key' });
            }
        }
        // Fallback to JWT cookie auth
        return (0, exports.requireAdmin)(req, res, next);
    }
    catch (error) {
        logger_1.logger.warn({ error }, 'Admin authentication failed');
        return res.status(401).json({ error: 'Unauthorized' });
    }
};
exports.requireAdminOrAPIKey = requireAdminOrAPIKey;
