"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const auth_routes_1 = __importDefault(require("../../auth.routes"));
jest.mock('../../../utils/refreshToken', () => ({
    verifyAndRotateRefreshToken: jest.fn(),
}));
jest.mock('../../../utils/setAuthCookie', () => ({
    // we only need to assert clearAuthCookie was called
    clearAuthCookie: jest.fn(),
    // keep others as real or mock, doesn't matter for this test
    setAccessTokenCookie: jest.fn(),
    setRefreshTokenCookie: jest.fn(),
}));
const { verifyAndRotateRefreshToken } = require('../../../utils/refreshToken');
const { clearAuthCookie } = require('../../../utils/setAuthCookie');
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
app.use('/api/auth', auth_routes_1.default);
describe('POST /api/auth/refresh (reuse detection)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.JWT_SECRET = 'testsecret';
    });
    it('401 and clears cookies when refresh token reuse is detected', async () => {
        verifyAndRotateRefreshToken.mockResolvedValue({
            ok: false,
            reason: 'REUSED',
        });
        const res = await (0, supertest_1.default)(app)
            .post('/api/auth/refresh')
            .set('Cookie', ['refreshToken=revokedTokenUsedAgain'])
            .send();
        expect(res.status).toBe(401);
        expect(clearAuthCookie).toHaveBeenCalled();
    });
});
