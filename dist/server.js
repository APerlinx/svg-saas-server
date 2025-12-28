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
// Initialize Sentry in production only
if (env_1.IS_PRODUCTION && process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: env_1.NODE_ENV,
        tracesSampleRate: 1.0,
    });
}
const app_1 = __importDefault(require("./app"));
const jobs_1 = require("./jobs");
const logger_1 = require("./lib/logger");
const redis_1 = require("./lib/redis");
// Connect to Redis
(0, redis_1.connectRedis)().catch((err) => {
    logger_1.logger.error({ error: err }, 'Failed to connect to Redis on startup');
});
app_1.default.listen(env_1.PORT, () => {
    logger_1.logger.info(`Server running at ${env_1.PORT}`);
    logger_1.logger.info(`🌍 Environment: ${env_1.IS_PRODUCTION ? 'production' : 'development'}`);
    logger_1.logger.info(`🛡️  CSRF protection: enabled`);
    logger_1.logger.info(`🍪 Frontend URL: ${env_1.FRONTEND_URL}`);
    (0, jobs_1.startScheduledJobs)();
});
