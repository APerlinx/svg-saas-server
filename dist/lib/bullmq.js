"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBullMqConnection = createBullMqConnection;
const ioredis_1 = __importDefault(require("ioredis"));
const env_1 = require("../config/env");
const logger_1 = require("./logger");
function createBullMqConnection(context) {
    const connection = new ioredis_1.default(env_1.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    });
    connection.on('connect', () => logger_1.logger.info({ context }, 'BullMQ Redis connected'));
    connection.on('reconnecting', () => logger_1.logger.warn({ context }, 'BullMQ Redis reconnecting'));
    connection.on('error', (error) => {
        logger_1.logger.error({ error, context }, 'BullMQ Redis connection error');
    });
    return connection;
}
