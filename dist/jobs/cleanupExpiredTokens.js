"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupExpiredTokens = cleanupExpiredTokens;
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = require("../lib/logger");
// This function cleans up expired tokens
async function cleanupExpiredTokens() {
    try {
        // Clean up expired password reset tokens
        const resetTokenResult = await prisma_1.default.user.updateMany({
            where: {
                resetPasswordExpires: {
                    lt: new Date(),
                },
            },
            data: {
                resetPasswordToken: null,
                resetPasswordExpires: null,
            },
        });
        logger_1.logger.info({ count: resetTokenResult.count }, 'Cleaned up expired reset tokens');
        // Clean up expired refresh tokens (THIS IS NEW)
        const refreshTokenResult = await prisma_1.default.refreshToken.deleteMany({
            where: {
                expiresAt: {
                    lt: new Date(),
                },
            },
        });
        logger_1.logger.info({ count: refreshTokenResult.count }, 'Cleaned up expired refresh tokens');
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Error cleaning up expired tokens');
    }
}
