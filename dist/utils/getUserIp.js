"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserIp = void 0;
// Get IP address
const getUserIp = (req) => {
    var _a;
    return (((_a = req.headers['x-forwarded-for']) === null || _a === void 0 ? void 0 : _a.split(',')[0].trim()) ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        'unknown');
};
exports.getUserIp = getUserIp;
