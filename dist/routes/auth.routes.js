"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const auth_1 = require("../middleware/auth");
const createPasswordResetToken_1 = require("../utils/createPasswordResetToken");
const emailService_1 = require("../services/emailService");
const rateLimiter_1 = require("../middleware/rateLimiter");
const getUserIp_1 = require("../utils/getUserIp");
const passport_1 = __importDefault(require("../config/passport"));
const getUserId_1 = require("../utils/getUserId");
const sanitizeInput_1 = require("../utils/sanitizeInput");
const csrf_1 = require("../middleware/csrf");
const validateInput_1 = require("../utils/validateInput");
const tokenExpiry_1 = require("../constants/tokenExpiry");
const logger_1 = require("../lib/logger");
const setAuthCookie_1 = require("../utils/setAuthCookie");
const refreshToken_1 = require("../utils/refreshToken");
const router = (0, express_1.Router)();
// User registration
router.post('/register', csrf_1.validateCsrfToken, rateLimiter_1.authLimiter, async (req, res) => {
    try {
        let { email, password, name, agreedToTerms } = req.body;
        email = (0, sanitizeInput_1.sanitizeInput)((email === null || email === void 0 ? void 0 : email.toLowerCase()) || '');
        name = (0, sanitizeInput_1.sanitizeInput)(name || '');
        // Validate inputs
        const emailError = (0, validateInput_1.validateEmail)(email);
        if (emailError) {
            return res.status(400).json({ error: emailError });
        }
        const passwordError = (0, validateInput_1.validatePassword)(password);
        if (passwordError) {
            return res.status(400).json({ error: passwordError });
        }
        const nameError = (0, validateInput_1.validateName)(name);
        if (nameError) {
            return res.status(400).json({ error: nameError });
        }
        if (agreedToTerms !== true) {
            return res.status(400).json({
                error: 'You must accept the Terms of Service and Privacy Policy to create an account',
            });
        }
        // Check if user already exists
        const existingUser = await prisma_1.default.user.findUnique({
            where: { email },
        });
        if (existingUser) {
            return res
                .status(400)
                .json({ error: 'Email is invalid or already taken' });
        }
        // Hash password
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        const user = await prisma_1.default.user.create({
            data: {
                email,
                passwordHash: hashedPassword,
                name,
                credits: 10,
                termsAcceptedAt: new Date(),
                termsAcceptedIp: (0, getUserIp_1.getUserIp)(req),
            },
        });
        // Generate access token (short-lived)
        const accessToken = jsonwebtoken_1.default.sign({ userId: user.id }, env_1.JWT_SECRET, {
            expiresIn: tokenExpiry_1.ACCESS_TOKEN_EXPIRY,
        });
        // Generate refresh token (long-lived, stored in DB)
        const { plainToken } = await (0, refreshToken_1.createRefreshToken)(user.id, tokenExpiry_1.REFRESH_TOKEN_EXPIRY_DAYS, (0, getUserIp_1.getUserIp)(req), req.headers['user-agent']);
        // Send welcome email
        // TODO: Move welcome email sending to a background job (BullMQ) to keep OAuth flow non-blocking
        await (0, emailService_1.sendWelcomeEmail)(email, name);
        // Set both cookies
        (0, setAuthCookie_1.setAccessTokenCookie)(res, accessToken);
        (0, setAuthCookie_1.setRefreshTokenCookie)(res, plainToken, false);
        res.status(201).json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                credits: user.credits,
                avatar: user.avatar,
            },
        });
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Registration error');
        res.status(500).json({ error: 'Internal server error' });
    }
});
// User login
router.post('/login', csrf_1.validateCsrfToken, rateLimiter_1.authLimiter, async (req, res) => {
    try {
        let { email, password, rememberMe } = req.body;
        email = (0, sanitizeInput_1.sanitizeInput)((email === null || email === void 0 ? void 0 : email.toLowerCase()) || '');
        // Validate inputs
        const emailError = (0, validateInput_1.validateEmail)(email);
        if (emailError) {
            return res.status(400).json({ error: emailError });
        }
        const passwordError = (0, validateInput_1.validatePassword)(password);
        if (passwordError) {
            return res.status(400).json({ error: passwordError });
        }
        const user = await prisma_1.default.user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                name: true,
                avatar: true,
                plan: true,
                credits: true,
                passwordHash: true,
            },
        });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const isMatch = await bcrypt_1.default.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        // Generate access token
        const accessToken = jsonwebtoken_1.default.sign({ userId: user.id }, env_1.JWT_SECRET, {
            expiresIn: tokenExpiry_1.ACCESS_TOKEN_EXPIRY,
        });
        // Generate refresh token
        const expiryDays = rememberMe ? 30 : tokenExpiry_1.REFRESH_TOKEN_EXPIRY_DAYS;
        const { plainToken } = await (0, refreshToken_1.createRefreshToken)(user.id, expiryDays, (0, getUserIp_1.getUserIp)(req), req.headers['user-agent']);
        // Set both cookies
        (0, setAuthCookie_1.setAccessTokenCookie)(res, accessToken);
        (0, setAuthCookie_1.setRefreshTokenCookie)(res, plainToken, rememberMe);
        const { passwordHash, ...safeUser } = user;
        res.json({ user: safeUser });
    }
    catch (error) {
        logger_1.logger.error({ error, userId: (0, getUserId_1.getUserId)(req) }, 'Logout error');
        res.status(500).json({ error: 'Internal server error' });
    }
});
// User logout
router.post('/logout', csrf_1.validateCsrfToken, auth_1.authMiddleware, async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        // Revoke refresh token from database
        if (refreshToken) {
            await (0, refreshToken_1.revokeRefreshToken)(refreshToken);
        }
        // Clear cookies
        (0, setAuthCookie_1.clearAuthCookie)(res);
        res.json({ message: 'Logged out successfully' });
    }
    catch (error) {
        logger_1.logger.error({ error, userId: (0, getUserId_1.getUserId)(req) }, 'Logout error');
        // Still clear cookies even if DB operation fails
        (0, setAuthCookie_1.clearAuthCookie)(res);
        res.json({ message: 'Logged out successfully' });
    }
});
// Refresh access token
router.post('/refresh', csrf_1.validateCsrfToken, async (req, res) => {
    logger_1.logger.debug('Refresh token request started');
    logger_1.logger.debug({
        hasRefreshToken: !!req.cookies.refreshToken,
        hasAccessToken: !!req.cookies.token,
        cookieCount: Object.keys(req.cookies).length,
    }, 'Request cookies');
    try {
        const oldRefreshToken = req.cookies.refreshToken;
        if (!oldRefreshToken)
            return res.status(401).json({ error: 'No refresh token provided' });
        const rotated = await (0, refreshToken_1.verifyAndRotateRefreshToken)(oldRefreshToken, tokenExpiry_1.REFRESH_TOKEN_EXPIRY_DAYS, (0, getUserIp_1.getUserIp)(req), req.headers['user-agent']);
        if (!rotated.ok) {
            if (rotated.reason === 'REUSED') {
                logger_1.logger.error({
                    ip: (0, getUserIp_1.getUserIp)(req),
                    userAgent: req.headers['user-agent'],
                    requestId: req.requestId,
                }, 'SECURITY: Refresh token reuse detected - token family revoked');
                (0, setAuthCookie_1.clearAuthCookie)(res);
            }
            return res
                .status(401)
                .json({ error: 'Invalid or expired refresh token' });
        }
        const { userId, newPlainToken } = rotated;
        // Generate new access token
        const newAccessToken = jsonwebtoken_1.default.sign({ userId }, env_1.JWT_SECRET, {
            expiresIn: tokenExpiry_1.ACCESS_TOKEN_EXPIRY,
        });
        // Set both new tokens
        (0, setAuthCookie_1.setAccessTokenCookie)(res, newAccessToken);
        (0, setAuthCookie_1.setRefreshTokenCookie)(res, newPlainToken, false);
        logger_1.logger.info({ userId }, 'Refresh token completed successfully');
        res.json({ message: 'Token refreshed successfully' });
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Token refresh error');
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get active sessions
router.get('/sessions', auth_1.authMiddleware, async (req, res) => {
    const userId = (0, getUserId_1.requireUserId)(req);
    const sessions = await prisma_1.default.refreshToken.findMany({
        where: { userId },
        select: {
            id: true,
            createdAt: true,
            lastUsedAt: true,
            ipAddress: true,
            userAgent: true,
        },
    });
    res.json({ sessions });
});
// Revoke specific session
router.delete('/sessions/:id', csrf_1.validateCsrfToken, auth_1.authMiddleware, async (req, res) => {
    const userId = (0, getUserId_1.requireUserId)(req);
    const { id } = req.params;
    await prisma_1.default.refreshToken.deleteMany({
        where: { id, userId }, // Ensure user owns this token
    });
    res.json({ message: 'Session revoked' });
});
// Get current authenticated user
router.get('/current-user', auth_1.authMiddleware, async (req, res) => {
    const userId = (0, getUserId_1.requireUserId)(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await prisma_1.default.user.findUnique({
        where: { id: userId },
    });
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    const safeUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        credits: user.credits || 0,
    };
    res.json(safeUser);
});
// Forgot password
router.post('/forgot-password', csrf_1.validateCsrfToken, rateLimiter_1.forgotPasswordLimiter, async (req, res) => {
    try {
        let { email } = req.body;
        email = (0, sanitizeInput_1.sanitizeInput)((email === null || email === void 0 ? void 0 : email.toLowerCase()) || '');
        // Validate email
        const emailError = (0, validateInput_1.validateEmail)(email);
        if (emailError) {
            return res.status(400).json({ error: emailError });
        }
        const user = await prisma_1.default.user.findUnique({ where: { email } });
        if (!user) {
            logger_1.logger.info({ email }, 'Password reset requested for non-existent email');
            return res.status(200).json({
                message: 'If that email is registered, a reset link has been sent.',
            });
        }
        const { resetToken, hashedToken, resetExpires } = (0, createPasswordResetToken_1.createPasswordResetToken)();
        await prisma_1.default.user.update({
            where: { id: user.id },
            data: {
                resetPasswordToken: hashedToken,
                resetPasswordExpires: resetExpires,
            },
        });
        await (0, emailService_1.sendPasswordResetEmail)(email, resetToken);
        logger_1.logger.info({ email }, 'Password reset token generated');
        res.status(200).json({
            message: 'If that email is registered, a reset link has been sent.',
        });
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Forgot password error');
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Reset password
router.post('/reset-password', csrf_1.validateCsrfToken, rateLimiter_1.forgotPasswordLimiter, async (req, res) => {
    try {
        const { token: resetToken, newPassword } = req.body;
        if (!resetToken || !newPassword) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        // Validate password
        const passwordError = (0, validateInput_1.validatePassword)(newPassword);
        if (passwordError) {
            return res.status(400).json({ error: passwordError });
        }
        const hashedToken = (0, createPasswordResetToken_1.hashResetToken)(resetToken);
        const user = await prisma_1.default.user.findFirst({
            where: {
                resetPasswordToken: hashedToken,
                resetPasswordExpires: { gt: new Date() },
            },
        });
        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }
        const hashedPassword = await bcrypt_1.default.hash(newPassword, 10);
        await prisma_1.default.user.update({
            where: { id: user.id },
            data: {
                passwordHash: hashedPassword,
                resetPasswordToken: null,
                resetPasswordExpires: null,
            },
        });
        // IMPORTANT: Revoke all refresh tokens when password is reset (security)
        await (0, refreshToken_1.revokeAllUserTokens)(user.id);
        res.status(200).json({
            message: 'Password has been reset successfully. Please log in again.',
        });
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Reset password error');
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Google OAuth
router.get('/google', (req, res, next) => {
    const redirectUrl = req.query.redirectUrl || '/';
    // Store redirectUrl in state parameter to retrieve after OAuth callback
    const state = Buffer.from(JSON.stringify({ redirectUrl, timestamp: Date.now() })).toString('base64');
    // Redirect user to Google's login page
    passport_1.default.authenticate('google', {
        scope: ['profile', 'email'],
        state,
    })(req, res, next);
});
// Handle callback from Google
router.get('/google/callback', passport_1.default.authenticate('google', {
    session: false,
    failureRedirect: `${env_1.FRONTEND_URL}/signin?error=oauth_failed`,
}), async (req, res) => {
    try {
        if (!req.user) {
            return res.redirect(`${env_1.FRONTEND_URL}/signin?error=no_user`);
        }
        const user = req.user;
        if (!(user === null || user === void 0 ? void 0 : user.id)) {
            return res.redirect(`${env_1.FRONTEND_URL}/signin?error=no_user`);
        }
        // Generate access token
        const accessToken = jsonwebtoken_1.default.sign({ userId: user.id }, env_1.JWT_SECRET, {
            expiresIn: tokenExpiry_1.ACCESS_TOKEN_EXPIRY,
        });
        // Generate refresh token
        const { plainToken } = await (0, refreshToken_1.createRefreshToken)(user.id, tokenExpiry_1.REFRESH_TOKEN_EXPIRY_DAYS, (0, getUserIp_1.getUserIp)(req), req.headers['user-agent']);
        // Set both cookies
        (0, setAuthCookie_1.setAccessTokenCookie)(res, accessToken);
        (0, setAuthCookie_1.setRefreshTokenCookie)(res, plainToken, false);
        // Extract redirectUrl from state parameter
        const state = req.query.state;
        let redirectUrl = '/'; // Default
        if (state) {
            try {
                const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
                const stateAge = Date.now() - (decoded.timestamp || 0);
                if (stateAge > 10 * 60 * 1000) {
                    // State too old, use default
                }
                else {
                    redirectUrl = decoded.redirectUrl || '/';
                }
            }
            catch (error) {
                logger_1.logger.warn({ error }, 'Error decoding OAuth state parameter');
            }
        }
        res.redirect(`${env_1.FRONTEND_URL}${redirectUrl}`);
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Google OAuth callback error');
        res.redirect(`${env_1.FRONTEND_URL}/signin?error=server_error`);
    }
});
// GitHub OAuth
router.get('/github', (req, res, next) => {
    const redirectUrl = req.query.redirectUrl || '/';
    // Store redirectUrl in state parameter to retrieve after OAuth callback
    const state = Buffer.from(JSON.stringify({ redirectUrl, timestamp: Date.now() })).toString('base64');
    // Redirect user to GitHub's login page
    passport_1.default.authenticate('github', {
        scope: ['user:email'],
        state,
    })(req, res, next);
});
// Handle callback from GitHub
router.get('/github/callback', passport_1.default.authenticate('github', {
    session: false,
    failureRedirect: `${env_1.FRONTEND_URL}/signin?error=oauth_failed`,
}), async (req, res) => {
    try {
        if (!req.user) {
            return res.redirect(`${env_1.FRONTEND_URL}/signin?error=no_user`);
        }
        const user = req.user;
        if (!(user === null || user === void 0 ? void 0 : user.id)) {
            return res.redirect(`${env_1.FRONTEND_URL}/signin?error=no_user`);
        }
        // Generate access token
        const accessToken = jsonwebtoken_1.default.sign({ userId: user.id }, env_1.JWT_SECRET, {
            expiresIn: tokenExpiry_1.ACCESS_TOKEN_EXPIRY,
        });
        // Generate refresh token
        const { plainToken } = await (0, refreshToken_1.createRefreshToken)(user.id, tokenExpiry_1.REFRESH_TOKEN_EXPIRY_DAYS, (0, getUserIp_1.getUserIp)(req), req.headers['user-agent']);
        // Set both cookies
        (0, setAuthCookie_1.setAccessTokenCookie)(res, accessToken);
        (0, setAuthCookie_1.setRefreshTokenCookie)(res, plainToken, false);
        // Extract redirectUrl from state parameter
        const state = req.query.state;
        let redirectUrl = '/'; // Default
        if (state) {
            try {
                const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
                const stateAge = Date.now() - (decoded.timestamp || 0);
                if (stateAge > 10 * 60 * 1000) {
                    // State too old, use default
                }
                else {
                    redirectUrl = decoded.redirectUrl || '/';
                }
            }
            catch (error) {
                logger_1.logger.warn({ error }, 'Error decoding OAuth state parameter');
            }
        }
        res.redirect(`${env_1.FRONTEND_URL}${redirectUrl}`);
    }
    catch (error) {
        logger_1.logger.error({ error }, 'GitHub OAuth callback error');
        res.redirect(`${env_1.FRONTEND_URL}/signin?error=server_error`);
    }
});
exports.default = router;
