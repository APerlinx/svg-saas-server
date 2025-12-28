"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearAuthCookie = exports.setAuthCookie = exports.setRefreshTokenCookie = exports.setAccessTokenCookie = void 0;
const env_1 = require("../config/env");
/**
 * Set access token cookie (short-lived, for API requests)
 */
const setAccessTokenCookie = (res, token) => {
    res.cookie('token', token, {
        httpOnly: true, // JavaScript can't access it (XSS protection)
        secure: env_1.IS_PRODUCTION, // HTTPS only in production
        sameSite: env_1.IS_PRODUCTION ? 'none' : 'lax',
        maxAge: 15 * 60 * 1000, // 15 minutes (matches ACCESS_TOKEN_EXPIRY)
        path: '/',
    });
};
exports.setAccessTokenCookie = setAccessTokenCookie;
/**
 * Set refresh token cookie (long-lived, for getting new access tokens)
 */
const setRefreshTokenCookie = (res, token, rememberMe = false) => {
    const maxAge = rememberMe
        ? 30 * 24 * 60 * 60 * 1000 // 30 days if "remember me"
        : 7 * 24 * 60 * 60 * 1000; // 7 days by default
    res.cookie('refreshToken', token, {
        httpOnly: true, // JavaScript can't access it
        secure: env_1.IS_PRODUCTION,
        sameSite: env_1.IS_PRODUCTION ? 'none' : 'lax',
        maxAge,
        path: '/', // Available on all routes
    });
};
exports.setRefreshTokenCookie = setRefreshTokenCookie;
/**
 * Legacy function - sets both tokens
 * Keep for backward compatibility, but use specific functions in new code
 */
const setAuthCookie = (res, accessToken, refreshToken, rememberMe = false) => {
    (0, exports.setAccessTokenCookie)(res, accessToken);
    (0, exports.setRefreshTokenCookie)(res, refreshToken, rememberMe);
};
exports.setAuthCookie = setAuthCookie;
/**
 * Clear all auth cookies (logout)
 */
const clearAuthCookie = (res) => {
    // Clear access token
    res.clearCookie('token', {
        httpOnly: true,
        secure: env_1.IS_PRODUCTION,
        sameSite: env_1.IS_PRODUCTION ? 'none' : 'lax',
        path: '/',
    });
    // Clear refresh token
    res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: env_1.IS_PRODUCTION,
        sameSite: env_1.IS_PRODUCTION ? 'none' : 'lax',
        path: '/',
    });
};
exports.clearAuthCookie = clearAuthCookie;
