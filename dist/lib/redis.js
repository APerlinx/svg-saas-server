"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisClient = void 0;
exports.connectRedis = connectRedis;
exports.disconnectRedis = disconnectRedis;
const redis_1 = require("redis");
const logger_1 = require("./logger");
const env_1 = require("../config/env");
exports.redisClient = (0, redis_1.createClient)({
    url: env_1.REDIS_URL,
});
exports.redisClient.on('error', (err) => {
    logger_1.logger.error({ error: err }, 'Redis client error');
});
exports.redisClient.on('connect', () => {
    logger_1.logger.info('Redis client connected');
});
exports.redisClient.on('ready', () => {
    logger_1.logger.info('Redis client ready');
});
// Connect to Redis
async function connectRedis() {
    if (env_1.IS_TEST) {
        logger_1.logger.info('Skipping Redis connection in test mode');
        return;
    }
    try {
        await exports.redisClient.connect();
        logger_1.logger.info('Redis connection established');
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Failed to connect to Redis');
        // Don't crash the app if Redis is unavailable
        // App can still work without caching
    }
}
// Graceful shutdown
async function disconnectRedis() {
    try {
        await exports.redisClient.quit();
        logger_1.logger.info('Redis connection closed');
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Error closing Redis connection');
    }
}
