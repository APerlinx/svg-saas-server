"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserId = getUserId;
exports.requireUserId = requireUserId;
function getUserId(req) {
    var _a;
    return (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
}
function requireUserId(req) {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
    if (!userId) {
        throw new Error('User not authenticated');
    }
    return userId;
}
