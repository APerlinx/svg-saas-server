"use strict";
/**
 * Credit Refill Cron Job
 * Runs every hour to process credit refills for users
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCreditRefillJob = startCreditRefillJob;
const node_cron_1 = __importDefault(require("node-cron"));
const creditRefillService_1 = require("../services/creditRefillService");
const logger_1 = require("../lib/logger");
/**
 * Start the credit refill cron job
 * Runs every hour at minute 0
 * Pattern: '0 * * * *' = At minute 0 of every hour
 */
function startCreditRefillJob() {
    node_cron_1.default.schedule('0 * * * *', async () => {
        logger_1.logger.info('Starting scheduled credit refill job');
        try {
            const processedCount = await (0, creditRefillService_1.batchProcessCreditRefills)();
            logger_1.logger.info({ processedCount }, 'Scheduled credit refill job completed successfully');
        }
        catch (error) {
            logger_1.logger.error({ error }, 'Scheduled credit refill job failed');
        }
    });
    logger_1.logger.info('Credit refill cron job started (runs hourly at minute 0)');
}
