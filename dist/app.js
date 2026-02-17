"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const Sentry = __importStar(require("@sentry/node"));
const helmet_1 = __importDefault(require("helmet"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const svg_routes_1 = __importDefault(require("./routes/svg.routes"));
const notification_routes_1 = __importDefault(require("./routes/notification.routes"));
const support_routes_1 = __importDefault(require("./routes/support.routes"));
const admin_routes_1 = __importDefault(require("./routes/admin.routes"));
const apiKeys_routes_1 = __importDefault(require("./routes/apiKeys.routes"));
const v1_routes_1 = __importDefault(require("./routes/v1.routes"));
const plans_routes_1 = __importDefault(require("./routes/plans.routes"));
const passport_1 = __importDefault(require("./config/passport"));
const env_1 = require("./config/env");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const csrf_1 = require("./middleware/csrf");
const rateLimiter_1 = require("./middleware/rateLimiter");
const requestId_1 = require("./middleware/requestId");
const logger_1 = require("./lib/logger");
const pino_http_1 = __importDefault(require("pino-http"));
const prisma_1 = __importDefault(require("./lib/prisma"));
const redis_1 = require("./lib/redis");
const instanceId_1 = require("./lib/instanceId");
const app = (0, express_1.default)();
// Behind Cloudflare / reverse proxies, req.ip is only correct if trust proxy is configured.
// This affects rate limiting, security logging, and audit trails.
app.set('trust proxy', env_1.TRUST_PROXY);
const previewOriginRegex = process.env.FRONTEND_PREVIEW_REGEX
    ? new RegExp(process.env.FRONTEND_PREVIEW_REGEX)
    : null;
// CORS configuration for web app routes
const webAppCorsOptions = {
    origin: (origin, cb) => {
        if (!origin)
            return cb(null, true);
        if (origin === process.env.FRONTEND_URL)
            return cb(null, true);
        if (previewOriginRegex === null || previewOriginRegex === void 0 ? void 0 : previewOriginRegex.test(origin))
            return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'x-idempotency-key'],
};
// CORS configuration for public API routes
const publicApiCorsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key'],
    credentials: false,
};
// Security headers
const cloudFrontDomain = env_1.PUBLIC_ASSETS_BASE_URL
    ? new URL(env_1.PUBLIC_ASSETS_BASE_URL).origin
    : null;
app.use((0, helmet_1.default)({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'", // React/Vite inline scripts
                "'unsafe-eval'", // Development hot reload
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'", // React inline styles, CSS-in-JS
            ],
            imgSrc: [
                "'self'",
                'data:', // Base64 images
                'blob:', // Blob URLs
                'https:', // CloudFront, S3 pre-signed URLs
                ...(cloudFrontDomain ? [cloudFrontDomain] : []),
            ],
            connectSrc: [
                "'self'",
                'ws:', // WebSocket (development)
                'wss:', // WebSocket (production)
                ...(env_1.FRONTEND_URL ? [env_1.FRONTEND_URL] : []),
            ],
            fontSrc: ["'self'", 'data:', 'https:'], // Google Fonts, etc.
            objectSrc: ["'none'"], // No Flash, Java, etc.
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"], // No iframes (prevent clickjacking)
            formAction: ["'self'"],
            upgradeInsecureRequests: env_1.IS_PRODUCTION ? [] : null, // Force HTTPS in production
        },
    },
    hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
    },
    frameguard: {
        action: 'deny', // X-Frame-Options: DENY
    },
    noSniff: true, // X-Content-Type-Options: nosniff
    xssFilter: true, // X-XSS-Protection: 1; mode=block (legacy browsers)
    referrerPolicy: {
        policy: 'strict-origin-when-cross-origin',
    },
}));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
app.use(requestId_1.requestIdMiddleware);
app.use((req, res, next) => {
    res.setHeader('x-instance-id', instanceId_1.INSTANCE_ID);
    next();
});
app.use((req, res, next) => {
    if (req.path === '/health')
        return next();
    return (0, csrf_1.generateCsrfToken)(req, res, next);
});
app.use(passport_1.default.initialize());
app.use((0, pino_http_1.default)({
    logger: logger_1.logger,
    customProps: (req) => ({
        requestId: req.requestId,
    }),
}));
app.get('/api/health', (req, res) => {
    res.status(200).json({ ok: true });
});
app.get('/api/ready', async (req, res) => {
    try {
        await prisma_1.default.$queryRaw `SELECT 1`;
        let redisStatus = 'disconnected';
        try {
            if (redis_1.redisClient.isReady) {
                await redis_1.redisClient.ping();
                redisStatus = 'connected';
            }
        }
        catch (redisError) {
            logger_1.logger.warn({ error: redisError }, 'Redis check failed in readiness probe');
        }
        res.status(200).json({
            ok: true,
            database: 'connected',
            redis: redisStatus,
        });
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Readiness check failed');
        res.status(503).json({
            ok: false,
            database: 'disconnected',
            error: 'Service unavailable',
        });
    }
});
app.use('/api', rateLimiter_1.apiLimiter);
app.get('/api/csrf', (0, cors_1.default)(webAppCorsOptions), (req, res) => {
    var _a;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ csrfToken: (_a = req.cookies['csrf-token']) !== null && _a !== void 0 ? _a : req.csrfToken });
});
// Web app routes - restrictive CORS
app.use('/api/auth', (0, cors_1.default)(webAppCorsOptions), auth_routes_1.default);
app.use('/api/plans', (0, cors_1.default)(webAppCorsOptions), plans_routes_1.default);
app.use('/api/user', (0, cors_1.default)(webAppCorsOptions), csrf_1.validateCsrfToken, user_routes_1.default);
app.use('/api/svg', (0, cors_1.default)(webAppCorsOptions), csrf_1.validateCsrfToken, svg_routes_1.default);
app.use('/api/notification', (0, cors_1.default)(webAppCorsOptions), csrf_1.validateCsrfToken, notification_routes_1.default);
app.use('/api/support', (0, cors_1.default)(webAppCorsOptions), csrf_1.validateCsrfToken, support_routes_1.default);
app.use('/api/keys', (0, cors_1.default)(webAppCorsOptions), csrf_1.validateCsrfToken, apiKeys_routes_1.default);
app.use('/api/admin', (0, cors_1.default)(webAppCorsOptions), admin_routes_1.default);
// Public API routes - open CORS
app.use('/v1', (0, cors_1.default)(publicApiCorsOptions), v1_routes_1.default);
app.use((err, req, res, next) => {
    // Log error with Pino
    logger_1.logger.error({ error: err, path: req.path, requestId: req.requestId }, 'Unhandled error');
    // Capture error in Sentry (production only)
    if (env_1.IS_PRODUCTION && process.env.SENTRY_DSN) {
        Sentry.captureException(err);
    }
    res.status(500).json({
        error: 'Internal server error',
        requestId: req.requestId,
    });
});
exports.default = app;
