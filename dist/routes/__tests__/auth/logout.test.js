"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const auth_routes_1 = __importDefault(require("../../auth.routes"));
const setAuthCookie_1 = require("../../../utils/setAuthCookie");
const refreshToken_1 = require("../../../utils/refreshToken");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
// Mocks
jest.mock('../../../middleware/auth', () => ({
    authMiddleware: (req, res, next) => next(),
}));
jest.mock('../../../utils/setAuthCookie', () => ({
    clearAuthCookie: jest.fn(),
}));
jest.mock('../../../utils/refreshToken', () => ({
    revokeRefreshToken: jest.fn(),
}));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
app.use('/api/auth', auth_routes_1.default);
describe('POST /logout', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('should revoke refresh token and clear cookies if refresh token is present', async () => {
        ;
        refreshToken_1.revokeRefreshToken.mockResolvedValue(undefined);
        setAuthCookie_1.clearAuthCookie.mockImplementation(() => { });
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/logout')
            .set('Cookie', 'refreshToken=testtoken')
            .send();
        expect(refreshToken_1.revokeRefreshToken).toHaveBeenCalledWith('testtoken');
        expect(setAuthCookie_1.clearAuthCookie).toHaveBeenCalled();
        expect(res.body).toEqual({ message: 'Logged out successfully' });
        expect(res.status).toBe(200);
    });
    it('should clear cookies even if no refresh token is present', async () => {
        const res = await (0, supertest_1.default)(app).post('/api/auth/logout').send();
        expect(refreshToken_1.revokeRefreshToken).not.toHaveBeenCalled();
        expect(setAuthCookie_1.clearAuthCookie).toHaveBeenCalled();
        expect(res.body).toEqual({ message: 'Logged out successfully' });
        expect(res.status).toBe(200);
    });
    it('should clear cookies and respond even if revokeRefreshToken throws', async () => {
        ;
        refreshToken_1.revokeRefreshToken.mockRejectedValue(new Error('DB error'));
        setAuthCookie_1.clearAuthCookie.mockImplementation(() => { });
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/logout')
            .set('Cookie', 'refreshToken=testtoken')
            .send();
        expect(refreshToken_1.revokeRefreshToken).toHaveBeenCalledWith('testtoken');
        expect(setAuthCookie_1.clearAuthCookie).toHaveBeenCalled();
        expect(res.body).toEqual({ message: 'Logged out successfully' });
        expect(res.status).toBe(200);
    });
});
