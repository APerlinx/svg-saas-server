"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserId = getUserId;
exports.requireUserId = requireUserId;
/**
 * Get user ID from request
 * Supports both JWT auth (userId) and API key auth (id)
 */
function getUserId(req) {
    var _a, _b;
    // JWT auth uses req.user.userId
    const jwtUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
    if (jwtUserId)
        return jwtUserId;
    // API key auth / OAuth uses req.user.id
    const prismaUserId = (_b = req.user) === null || _b === void 0 ? void 0 : _b.id;
    return prismaUserId;
}
function requireUserId(req) {
    const userId = getUserId(req);
    if (!userId) {
        throw new Error('User not authenticated');
    }
    return userId;
}
