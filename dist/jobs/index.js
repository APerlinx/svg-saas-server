"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduledJobs = startScheduledJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const cleanupExpiredTokens_1 = require("./cleanupExpiredTokens");
const logger_1 = require("../lib/logger");
// This sets up the schedule for all jobs
function startScheduledJobs() {
    // Run cleanup every day at 3 AM
    node_cron_1.default.schedule('0 3 * * *', async () => {
        logger_1.logger.info('Running scheduled token cleanup...');
        await (0, cleanupExpiredTokens_1.cleanupExpiredTokens)();
    });
    logger_1.logger.info('Scheduled jobs initialized');
}
