"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCsrfToken = exports.generateCsrfToken = void 0;
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
/**
 * Generate CSRF token and set it as a cookie
 * This runs on every request to ensure token exists
 */
const generateCsrfToken = (req, res, next) => {
    // Skip if token already exists in this request cycle
    if (req.cookies['csrf-token']) {
        return next();
    }
    // Generate random 32-byte token
    const csrfToken = crypto_1.default.randomBytes(32).toString('hex');
    // Set cookie
    res.cookie('csrf-token', csrfToken, {
        httpOnly: false, // MUST be false - JS needs to read it
        secure: env_1.IS_PRODUCTION, // HTTPS only in production
        sameSite: env_1.IS_PRODUCTION ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/', // Available on all routes
    });
    next();
};
exports.generateCsrfToken = generateCsrfToken;
/**
 * Validate CSRF token on state-changing requests
 * Compares cookie value with header value
 */
const validateCsrfToken = (req, res, next) => {
    // Skip validation in test environment
    if (env_1.IS_TEST) {
        return next();
    }
    // Skip validation for safe methods (they don't change state)
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    // Skip validation for webhook endpoints (they use signature verification)
    if (req.path.includes('/webhook')) {
        return next();
    }
    // Skip validation for OAuth callback routes
    if (req.path.includes('/auth/google/callback') ||
        req.path.includes('/auth/github/callback')) {
        return next();
    }
    // Get token from header
    const headerToken = req.headers['x-csrf-token'];
    // Get token from cookie
    const cookieToken = req.cookies['csrf-token'];
    // Validate: both must exist and match
    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
        return res.status(403).json({
            error: 'Invalid CSRF token',
            message: 'Request blocked for security reasons',
        });
    }
    next();
};
exports.validateCsrfToken = validateCsrfToken;
