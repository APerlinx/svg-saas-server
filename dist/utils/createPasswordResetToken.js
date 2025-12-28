"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPasswordResetToken = createPasswordResetToken;
exports.hashResetToken = hashResetToken;
const crypto_1 = __importDefault(require("crypto"));
function createPasswordResetToken() {
    const resetToken = crypto_1.default.randomBytes(32).toString('hex');
    const hashedToken = crypto_1.default
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    return { resetToken, hashedToken, resetExpires };
}
function hashResetToken(resetToken) {
    return crypto_1.default.createHash('sha256').update(resetToken).digest('hex');
}
