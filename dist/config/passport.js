"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const passport_1 = __importDefault(require("passport"));
const passport_google_oauth20_1 = require("passport-google-oauth20");
const passport_github2_1 = require("passport-github2");
const prisma_1 = __importDefault(require("../lib/prisma"));
const env_1 = require("./env");
const emailService_1 = require("../services/emailService");
const logger_1 = require("../lib/logger");
// Configure Google OAuth strategy
passport_1.default.use(new passport_google_oauth20_1.Strategy({
    clientID: env_1.GOOGLE_CLIENT_ID,
    clientSecret: env_1.GOOGLE_CLIENT_SECRET,
    callbackURL: env_1.GOOGLE_REDIRECT_URI,
}, async (accessToken, refreshToken, profile, done) => {
    var _a, _b, _c, _d, _e, _f;
    try {
        // Extract user info from Google profile
        const googleId = profile.id;
        const email = (_b = (_a = profile.emails) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.value;
        const name = profile.displayName;
        const avatar = (_d = (_c = profile.photos) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.value;
        const emailVerified = (_f = (_e = profile.emails) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.verified;
        if (!email || !emailVerified) {
            logger_1.logger.error({ googleId }, 'Email not verified from Google');
            return done(new Error('Email not verified'), false);
        }
        logger_1.logger.debug({ googleId, email, name }, 'Google OAuth profile data');
        // Check if user exists by provider ID
        let user = await prisma_1.default.user.findUnique({
            where: {
                provider_providerId: {
                    provider: 'GOOGLE',
                    providerId: googleId,
                },
            },
        });
        if (!user) {
            logger_1.logger.debug({ email }, 'User not found by providerId, checking by email');
            // Check if user exists by email
            const existingUser = await prisma_1.default.user.findUnique({
                where: { email },
            });
            if (existingUser) {
                logger_1.logger.info({ email, provider: 'GOOGLE' }, 'Linking Google account to existing user');
                // Link Google account to existing email account
                user = await prisma_1.default.user.update({
                    where: { id: existingUser.id },
                    data: {
                        provider: 'GOOGLE',
                        providerId: googleId,
                        name: name || existingUser.name,
                        avatar: avatar || existingUser.avatar,
                    },
                });
            }
            else {
                logger_1.logger.info({ email, provider: 'GOOGLE' }, 'Creating new user via OAuth');
                // Create new user
                user = await prisma_1.default.user.create({
                    data: {
                        email,
                        name,
                        avatar,
                        provider: 'GOOGLE',
                        providerId: googleId,
                        passwordHash: null,
                        credits: 10,
                        termsAcceptedAt: new Date(),
                    },
                });
                // Send welcome email (don't fail OAuth if email fails)
                try {
                    await (0, emailService_1.sendWelcomeEmail)(email, name || 'User');
                    logger_1.logger.info({ email }, 'Welcome email sent to new OAuth user');
                }
                catch (emailError) {
                    logger_1.logger.error({ error: emailError, email }, 'Failed to send welcome email');
                }
            }
        }
        else {
            logger_1.logger.debug({ email }, 'Existing Google OAuth user found');
            // Update Avatar if changed on google
            if (avatar && user.avatar !== avatar) {
                logger_1.logger.debug({ email }, 'Updating avatar from Google');
                user = await prisma_1.default.user.update({
                    where: { id: user.id },
                    data: { avatar },
                });
            }
        }
        // Return the full user object
        return done(null, user);
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Passport Google OAuth strategy error');
        return done(error, false);
    }
}));
passport_1.default.use(new passport_github2_1.Strategy({
    clientID: env_1.GITHUB_CLIENT_ID,
    clientSecret: env_1.GITHUB_CLIENT_SECRET,
    callbackURL: env_1.GITHUB_REDIRECT_URI,
    scope: ['user:email'],
}, async (accessToken, refreshToken, profile, done) => {
    var _a, _b, _c, _d, _e, _f;
    try {
        const githubId = profile.id;
        const email = (_b = (_a = profile.emails) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.value;
        const emailVerified = (_d = (_c = profile.emails) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.verified;
        const name = profile.displayName || profile.username;
        const avatar = (_f = (_e = profile.photos) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.value;
        if (!email) {
            logger_1.logger.error({ githubId }, 'No email from GitHub profile');
            return done(new Error('No email from GitHub'), false);
        }
        logger_1.logger.debug({ githubId, email, name }, 'GitHub OAuth profile data');
        let user = await prisma_1.default.user.findUnique({
            where: {
                provider_providerId: {
                    provider: 'GITHUB',
                    providerId: githubId,
                },
            },
        });
        if (!user) {
            const existingUser = await prisma_1.default.user.findUnique({
                where: { email },
            });
            if (existingUser) {
                if (!emailVerified) {
                    logger_1.logger.error({ githubId, email }, 'Cannot link: GitHub email not verified');
                    return done(new Error('Please verify your email on GitHub to link accounts'), false);
                }
                user = await prisma_1.default.user.update({
                    where: { id: existingUser.id },
                    data: {
                        provider: 'GITHUB',
                        providerId: githubId,
                        name: name || existingUser.name,
                        avatar: avatar || existingUser.avatar,
                    },
                });
            }
            else {
                user = await prisma_1.default.user.create({
                    data: {
                        email,
                        name,
                        avatar,
                        provider: 'GITHUB',
                        providerId: githubId,
                        passwordHash: null,
                        credits: 10,
                        termsAcceptedAt: new Date(),
                    },
                });
                try {
                    await (0, emailService_1.sendWelcomeEmail)(email, name || 'User');
                }
                catch (emailError) {
                    logger_1.logger.error({ error: emailError, email }, 'Failed to send welcome email to GitHub user');
                }
            }
        }
        else {
            if (avatar && user.avatar !== avatar) {
                user = await prisma_1.default.user.update({
                    where: { id: user.id },
                    data: { avatar },
                });
            }
        }
        return done(null, user);
    }
    catch (error) {
        logger_1.logger.error({ error }, 'GitHub OAuth error');
        return done(error, false);
    }
}));
exports.default = passport_1.default;
