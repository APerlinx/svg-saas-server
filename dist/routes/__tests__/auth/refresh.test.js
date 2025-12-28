"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// IMPORTANT: mocks must be declared BEFORE importing the router
jest.mock('../../../utils/refreshToken', () => ({
    verifyAndRotateRefreshToken: jest.fn(),
}));
jest.mock('../../../utils/getUserIp', () => ({
    getUserIp: jest.fn(() => '127.0.0.1'),
}));
// If your /api/auth routes are protected by validateCsrfToken middleware,
// you either need to send a valid CSRF cookie+header OR mock it.
// We'll do the cookie+header approach (closest to real behavior).
const { verifyAndRotateRefreshToken } = require('../../../utils/refreshToken');
//  Import router AFTER mocks
const auth_routes_1 = __importDefault(require("../../auth.routes"));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
app.use('/api/auth', auth_routes_1.default);
// helper to satisfy CSRF middleware (if present)
const withCsrf = (cookies = []) => {
    const csrf = 'test-csrf';
    return [`csrf-token=${csrf}`, ...cookies];
};
describe('POST /api/auth/refresh', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.JWT_SECRET = 'testsecret';
    });
    it('401 if no refresh token is provided', async () => {
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/refresh')
            .set('Cookie', withCsrf()) // include CSRF cookie
            .set('X-CSRF-Token', 'test-csrf') // include CSRF header
            .send();
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'No refresh token provided' });
    });
    it('401 if refresh token not found', async () => {
        verifyAndRotateRefreshToken.mockResolvedValue({
            ok: false,
            reason: 'NOT_FOUND',
        });
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/refresh')
            .set('Cookie', withCsrf(['refreshToken=someToken']))
            .set('X-CSRF-Token', 'test-csrf')
            .send();
        expect(res.status).toBe(401);
    });
    it('401 if refresh token is invalid/expired', async () => {
        verifyAndRotateRefreshToken.mockResolvedValue({
            ok: false,
            reason: 'EXPIRED',
        });
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/refresh')
            .set('Cookie', withCsrf(['refreshToken=invalidtoken']))
            .set('X-CSRF-Token', 'test-csrf')
            .send();
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'Invalid or expired refresh token' });
    });
    it('200 and sets BOTH cookies on success', async () => {
        verifyAndRotateRefreshToken.mockResolvedValue({
            ok: true,
            userId: 'user123',
            newPlainToken: 'newRefreshTokenPlain',
        });
        jest.spyOn(jsonwebtoken_1.default, 'sign').mockReturnValue('newAccessToken');
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/refresh')
            .set('Cookie', withCsrf(['refreshToken=validtoken']))
            .set('X-CSRF-Token', 'test-csrf')
            .send();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ message: 'Token refreshed successfully' });
        const setCookie = res.headers['set-cookie'];
        expect(setCookie).toBeDefined();
        const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
        const all = cookies.join(';');
        expect(all).toContain('token=');
        expect(all).toContain('refreshToken=');
        expect(all).toContain('HttpOnly');
    });
    it('500 on unexpected error', async () => {
        verifyAndRotateRefreshToken.mockImplementation(() => {
            throw new Error('fail');
        });
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/refresh')
            .set('Cookie', withCsrf(['refreshToken=validtoken']))
            .set('X-CSRF-Token', 'test-csrf')
            .send();
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: 'Internal server error' });
    });
});
