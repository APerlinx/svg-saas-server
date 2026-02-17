"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLIC_ASSETS_BASE_URL = exports.IS_S3_ENABLED = exports.S3_SIGNED_URL_TTL = exports.S3_BUCKET = exports.AWS_REGION = exports.GITHUB_REDIRECT_URI = exports.GITHUB_CLIENT_SECRET = exports.GITHUB_CLIENT_ID = exports.GOOGLE_REDIRECT_URI = exports.GOOGLE_CLIENT_SECRET = exports.GOOGLE_CLIENT_ID = exports.REDIS_URL = exports.ADMIN_API_KEY = exports.ADMIN_EMAIL = exports.SUPPORT_INBOX_EMAIL = exports.RESEND_API_KEY = exports.OPENAI_API_KEY = exports.JWT_SECRET = exports.FRONTEND_URL = exports.TRUST_PROXY = exports.IS_TEST = exports.IS_DEVELOPMENT = exports.IS_PRODUCTION = exports.NODE_ENV = exports.PORT = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Server Configuration
exports.PORT = process.env.PORT || 4000;
// Environment detection
exports.NODE_ENV = process.env.NODE_ENV || 'development';
exports.IS_PRODUCTION = exports.NODE_ENV === 'production';
exports.IS_DEVELOPMENT = exports.NODE_ENV === 'development';
exports.IS_TEST = exports.NODE_ENV === 'test';
// Reverse proxy / CDN configuration.
exports.TRUST_PROXY = (() => {
    const raw = process.env.TRUST_PROXY;
    if (raw == null || raw.trim() === '') {
        return exports.IS_PRODUCTION ? 1 : false;
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true')
        return true;
    if (normalized === 'false')
        return false;
    const hops = Number(normalized);
    if (Number.isFinite(hops) && hops >= 0)
        return hops;
    return exports.IS_PRODUCTION ? 1 : false;
})();
// Frontend URL
exports.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
// Authentication
exports.JWT_SECRET = process.env.JWT_SECRET;
if (!exports.JWT_SECRET || exports.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be defined and at least 32 characters long');
}
// AI Models / APIs
exports.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!exports.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY must be defined');
}
// Email Service
exports.RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!exports.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY must be defined in .env file');
}
// Support inbox (where contact/bug/idea submissions are delivered)
exports.SUPPORT_INBOX_EMAIL = process.env.SUPPORT_INBOX_EMAIL || 'chatsvg.dev@gmail.com';
// Admin email (for magic link authentication)
exports.ADMIN_EMAIL = process.env.ADMIN_EMAIL;
if (!exports.ADMIN_EMAIL && exports.IS_PRODUCTION) {
    throw new Error('ADMIN_EMAIL must be defined in production .env file');
}
// Admin API key (for n8n/automation access)
exports.ADMIN_API_KEY = process.env.ADMIN_API_KEY;
if (exports.IS_PRODUCTION && !exports.ADMIN_API_KEY) {
    throw new Error('ADMIN_API_KEY must be defined in production');
}
// Redis Configuration
exports.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
// Google OAuth - validate at startup
exports.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
exports.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
exports.GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
if (!exports.GOOGLE_CLIENT_ID || !exports.GOOGLE_CLIENT_SECRET || !exports.GOOGLE_REDIRECT_URI) {
    throw new Error('Google OAuth credentials must be defined in .env file');
}
// GitHub OAuth - validate at startup
exports.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
exports.GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
exports.GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI;
if (!exports.GITHUB_CLIENT_ID || !exports.GITHUB_CLIENT_SECRET || !exports.GITHUB_REDIRECT_URI) {
    throw new Error('GitHub OAuth credentials must be defined in .env file');
}
// AWS S3 Configuration
exports.AWS_REGION = process.env.S3_REGION || process.env.AWS_REGION;
exports.S3_BUCKET = process.env.S3_BUCKET;
exports.S3_SIGNED_URL_TTL = process.env.S3_SIGNED_URL_TTL
    ? parseInt(process.env.S3_SIGNED_URL_TTL, 10)
    : 60; // default to 60 seconds
if (exports.IS_PRODUCTION && (!exports.AWS_REGION || !exports.S3_BUCKET)) {
    throw new Error('AWS_REGION and S3_BUCKET must be defined in .env file for production');
}
exports.IS_S3_ENABLED = !!(exports.AWS_REGION && exports.S3_BUCKET);
// Public assets (e.g. CloudFront) base URL used for gallery rendering.
// Example: https://dxxxx.cloudfront.net or https://assets.chatsvg.dev
// Optional so local/dev/test can run without CloudFront.
exports.PUBLIC_ASSETS_BASE_URL = (process.env.PUBLIC_ASSETS_BASE_URL ||
    process.env.CLOUDFRONT_ASSETS_BASE_URL ||
    '').replace(/\/+$/, '');
