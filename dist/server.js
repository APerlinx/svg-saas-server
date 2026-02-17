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
const env_1 = require("./config/env");
const Sentry = __importStar(require("@sentry/node"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const io_1 = require("./realtime/io");
const generationJobEvents_1 = require("./realtime/generationJobEvents");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const redis_adapter_1 = require("@socket.io/redis-adapter");
const redis_1 = require("redis");
// Initialize Sentry in production only
if (env_1.IS_PRODUCTION && process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: env_1.NODE_ENV,
        tracesSampleRate: 1.0,
    });
}
const app_1 = __importDefault(require("./app"));
const logger_1 = require("./lib/logger");
const redis_2 = require("./lib/redis");
const instanceId_1 = require("./lib/instanceId");
// Connect to Redis
(0, redis_2.connectRedis)().catch((err) => {
    logger_1.logger.error({ error: err }, 'Failed to connect to Redis on startup');
});
const httpServer = (0, http_1.createServer)(app_1.default);
async function enableSocketIoRedisAdapter(io) {
    if (env_1.IS_TEST)
        return;
    // recommend controlling via env so dev without Redis doesn't spam logs
    const enabled = process.env.SOCKET_IO_REDIS_ADAPTER === 'true' ||
        (env_1.IS_PRODUCTION && process.env.SOCKET_IO_REDIS_ADAPTER !== 'false');
    if (!enabled) {
        logger_1.logger.info('Socket.IO Redis adapter disabled');
        return;
    }
    try {
        const pubClient = (0, redis_1.createClient)({ url: env_1.REDIS_URL });
        const subClient = pubClient.duplicate();
        pubClient.on('error', (err) => logger_1.logger.error({ err }, 'Socket.IO Redis pubClient error'));
        subClient.on('error', (err) => logger_1.logger.error({ err }, 'Socket.IO Redis subClient error'));
        await pubClient.connect();
        await subClient.connect();
        io.adapter((0, redis_adapter_1.createAdapter)(pubClient, subClient));
        logger_1.logger.info({ redisUrl: env_1.REDIS_URL }, 'Socket.IO Redis adapter enabled');
    }
    catch (error) {
        logger_1.logger.warn({ error, redisUrl: env_1.REDIS_URL }, 'Failed to enable Socket.IO Redis adapter; using in-memory adapter');
    }
}
const previewOriginRegex = process.env.FRONTEND_PREVIEW_REGEX
    ? new RegExp(process.env.FRONTEND_PREVIEW_REGEX)
    : null;
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: (origin, cb) => {
            if (!origin)
                return cb(null, true);
            if (origin === env_1.FRONTEND_URL)
                return cb(null, true);
            if (previewOriginRegex === null || previewOriginRegex === void 0 ? void 0 : previewOriginRegex.test(origin))
                return cb(null, true);
            return cb(new Error('Not allowed by CORS'));
        },
        credentials: true,
    },
});
setupGracefulShutdown();
function setupGracefulShutdown() {
    let isShuttingDown = false;
    const signals = ['SIGTERM', 'SIGINT'];
    const closeSockets = () => new Promise((resolve) => {
        io.close(() => resolve());
    });
    const closeHttpServer = () => new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    const handleShutdown = async (signal) => {
        if (isShuttingDown)
            return;
        isShuttingDown = true;
        logger_1.logger.info({ signal }, 'Shutdown signal received, closing gracefully');
        try {
            await closeSockets();
            await closeHttpServer();
            await (0, redis_2.disconnectRedis)();
            logger_1.logger.info('Shutdown complete');
            process.exit(0);
        }
        catch (error) {
            logger_1.logger.error({ error }, 'Error during graceful shutdown');
            process.exit(1);
        }
    };
    signals.forEach((signal) => process.on(signal, handleShutdown));
}
function parseCookieHeader(header) {
    if (!header)
        return {};
    const out = {};
    for (const part of header.split(';')) {
        const [rawKey, ...rawVal] = part.trim().split('=');
        if (!rawKey)
            continue;
        out[rawKey] = decodeURIComponent(rawVal.join('=') || '');
    }
    return out;
}
io.use((socket, next) => {
    try {
        const cookieHeader = socket.request.headers.cookie;
        const cookies = parseCookieHeader(cookieHeader);
        const token = cookies.token;
        if (!token)
            return next(new Error('Unauthorized'));
        const decoded = jsonwebtoken_1.default.verify(token, env_1.JWT_SECRET);
        socket.data.userId = decoded.userId;
        return next();
    }
    catch {
        return next(new Error('Unauthorized'));
    }
});
io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.join(`user:${userId}`);
    logger_1.logger.info({ instanceId: instanceId_1.INSTANCE_ID, socketId: socket.id, userId }, 'Socket connected (authed)');
    socket.on('disconnect', (reason) => {
        logger_1.logger.info({ instanceId: instanceId_1.INSTANCE_ID, socketId: socket.id, userId, reason }, 'Socket disconnected');
    });
    socket.emit('server:ready', { ok: true });
});
async function main() {
    await enableSocketIoRedisAdapter(io);
    (0, io_1.initIO)(io);
    await (0, generationJobEvents_1.startGenerationJobRealtimeEvents)(io);
    httpServer.listen(env_1.PORT, () => {
        logger_1.logger.info(`Server running at ${env_1.PORT}`);
        logger_1.logger.info(`🌍 Environment: ${env_1.IS_PRODUCTION ? 'production' : 'development'}`);
        logger_1.logger.info(`🛡️  CSRF protection: enabled`);
        logger_1.logger.info(`🍪 Frontend URL: ${env_1.FRONTEND_URL}`);
        logger_1.logger.info({ instanceId: instanceId_1.INSTANCE_ID }, 'Server booted');
    });
}
main().catch((err) => {
    logger_1.logger.error({ error: err }, 'Server bootstrap failed');
    process.exit(1);
});
