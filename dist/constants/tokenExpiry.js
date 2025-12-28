"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESET_PASSWORD_TOKEN_EXPIRY = exports.REFRESH_TOKEN_EXPIRY_DAYS = exports.REFRESH_TOKEN_EXPIRY = exports.ACCESS_TOKEN_EXPIRY = void 0;
exports.ACCESS_TOKEN_EXPIRY = '15m'; // Access tokens expire in 15 minutes
exports.REFRESH_TOKEN_EXPIRY = '7d'; // Refresh tokens expire in 7 days
exports.REFRESH_TOKEN_EXPIRY_DAYS = 7; // For database storage
exports.RESET_PASSWORD_TOKEN_EXPIRY = '1h'; // Reset password tokens expire in 1 hour
