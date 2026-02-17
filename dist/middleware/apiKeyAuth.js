"use strict";
/**
 * API Key Authentication Middleware
 * Validates API keys for public API endpoints
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyAuth = apiKeyAuth;
const apiKeyService_1 = require("../services/apiKeyService");
const logger_1 = require("../lib/logger");
const planLimits_1 = require("../utils/planLimits");
/**
 * Extract client IP with Cloudflare priority
 * Cloudflare sets cf-connecting-ip to the real client IP
 * Fallback to Express req.ip (respects trust proxy setting)
 */
function getClientIp(req) {
    const cfIp = req.headers['cf-connecting-ip'];
    const ip = cfIp || req.ip || req.socket.remoteAddress || '';
    return ip.toString().replace('::ffff:', '');
}
/**
 * Middleware to authenticate API requests using API keys
 * Extracts X-API-Key header and validates it
 */
async function apiKeyAuth(req, res, next) {
    try {
        const rawKey = req.headers['x-api-key'];
        if (!rawKey) {
            res.status(401).json({
                error: 'Authentication required',
                message: 'Missing X-API-Key header',
            });
            return;
        }
        const clientIp = getClientIp(req);
        logger_1.logger.debug({
            clientIp,
            cfConnectingIp: req.headers['cf-connecting-ip'],
            rawIp: req.ip,
            socketIp: req.socket.remoteAddress,
            xForwardedFor: req.headers['x-forwarded-for'],
        }, 'API request IP detection');
        const validation = await (0, apiKeyService_1.validateApiKey)(rawKey, clientIp);
        if (!validation.valid) {
            logger_1.logger.warn({
                reason: validation.reason,
                ip: clientIp,
                path: req.path,
            }, 'API key validation failed');
            res.status(401).json({
                error: 'Invalid API key',
                message: validation.reason,
            });
            return;
        }
        req.user = validation.apiKey.user;
        req.apiKey = {
            id: validation.apiKey.id,
            userId: validation.apiKey.userId,
            name: validation.apiKey.name,
            scopes: validation.apiKey.scopes,
            customRateLimit: validation.apiKey.customRateLimit,
            ipWhitelist: validation.apiKey.ipWhitelist,
        };
        // Check if user's current plan allows API access
        const userPlan = validation.apiKey.user.plan;
        const planLimits = planLimits_1.PLAN_LIMITS[userPlan];
        if (!planLimits.apiAccess) {
            logger_1.logger.warn({
                userId: validation.apiKey.userId,
                plan: userPlan,
                apiKeyId: validation.apiKey.id,
                ip: clientIp,
            }, 'API access denied - plan does not allow API access');
            res.status(403).json({
                error: 'API access not available',
                message: `Your current plan (${userPlan}) does not include API access. Please upgrade to PRO or ENTERPRISE to use the API.`,
                currentPlan: userPlan,
            });
            return;
        }
        next();
    }
    catch (error) {
        logger_1.logger.error({
            error,
            path: req.path,
            method: req.method,
        }, 'API key authentication error');
        res.status(500).json({
            error: 'Authentication failed',
            message: 'An error occurred during authentication',
        });
    }
}
