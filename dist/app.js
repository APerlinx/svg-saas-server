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
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const svg_routes_1 = __importDefault(require("./routes/svg.routes"));
const passport_1 = __importDefault(require("./config/passport"));
const env_1 = require("./config/env");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const csrf_1 = require("./middleware/csrf");
const rateLimiter_1 = require("./middleware/rateLimiter");
const pino_http_1 = __importDefault(require("pino-http"));
const logger_1 = require("./lib/logger");
const Sentry = __importStar(require("@sentry/node"));
const requestId_1 = require("./middleware/requestId");
const prisma_1 = __importDefault(require("./lib/prisma"));
const redis_1 = require("./lib/redis");
const app = (0, express_1.default)();
const allowedOrigins = [
    process.env.FRONTEND_URL,
    process.env.FRONTEND_PREVIEW_REGEX,
].filter(Boolean);
app.use((0, cors_1.default)({
    origin: (origin, cb) => {
        if (!origin)
            return cb(null, true);
        if (origin === process.env.FRONTEND_URL)
            return cb(null, true);
        if (/^https:\/\/.*\.vercel\.app$/.test(origin))
            return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
}));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
// Add request ID tracking
app.use(requestId_1.requestIdMiddleware);
// Add CSRF token generation middleware
app.use((req, res, next) => {
    if (req.path === '/health')
        return next();
    return (0, csrf_1.generateCsrfToken)(req, res, next);
});
// Initialize Passport middleware
app.use(passport_1.default.initialize());
// Attach pino HTTP logger with requestId
app.use((0, pino_http_1.default)({
    logger: logger_1.logger,
    customProps: (req) => ({
        requestId: req.requestId,
    }),
}));
// Health check endpoint (simple liveness check)
app.get('/api/health', (req, res) => {
    res.status(200).json({ ok: true });
});
// Readiness check (database + Redis connectivity)
app.get('/api/ready', async (req, res) => {
    try {
        // Check database connectivity
        await prisma_1.default.$queryRaw `SELECT 1`;
        // Check Redis connectivity
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
// CSRF token endpoint
app.get('/api/csrf', (req, res) => {
    res.json({ csrfToken: req.cookies['csrf-token'] });
});
//Auth
app.use('/api/auth', auth_routes_1.default);
// users
app.use('/api/user', csrf_1.validateCsrfToken, user_routes_1.default);
// SVG generation
app.use('/api/svg', csrf_1.validateCsrfToken, svg_routes_1.default);
// Generic error handler
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
