"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GITHUB_REDIRECT_URI = exports.GITHUB_CLIENT_SECRET = exports.GITHUB_CLIENT_ID = exports.GOOGLE_REDIRECT_URI = exports.GOOGLE_CLIENT_SECRET = exports.GOOGLE_CLIENT_ID = exports.REDIS_URL = exports.RESEND_API_KEY = exports.OPENAI_API_KEY = exports.JWT_SECRET = exports.FRONTEND_URL = exports.IS_TEST = exports.IS_DEVELOPMENT = exports.IS_PRODUCTION = exports.NODE_ENV = exports.PORT = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Server Configuration
exports.PORT = process.env.PORT || 4000;
// Environment detection
exports.NODE_ENV = process.env.NODE_ENV || 'development';
exports.IS_PRODUCTION = exports.NODE_ENV === 'production';
exports.IS_DEVELOPMENT = exports.NODE_ENV === 'development';
exports.IS_TEST = exports.NODE_ENV === 'test';
// Frontend URL
exports.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
// Authentication
exports.JWT_SECRET = process.env.JWT_SECRET;
if (!exports.JWT_SECRET || exports.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be defined and at least 32 characters long');
}
// AI Models / APIs
exports.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Add more AI model keys here as needed
// export const REPLICATE_API_KEY = process.env.REPLICATE_API_KEY as string
// export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY as string
if (!exports.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY must be defined');
}
// Email Service
exports.RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!exports.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY must be defined in .env file');
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
