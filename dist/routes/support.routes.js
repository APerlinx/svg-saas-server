"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const getUserId_1 = require("../utils/getUserId");
const logger_1 = require("../lib/logger");
const sanitizeInput_1 = require("../utils/sanitizeInput");
const getUserIp_1 = require("../utils/getUserIp");
const rateLimiter_1 = require("../middleware/rateLimiter");
const prisma_1 = __importDefault(require("../lib/prisma"));
const emailService_1 = require("../services/emailService");
const router = (0, express_1.Router)();
const SUPPORT_TYPES = ['contact', 'bug', 'idea'];
function isSupportType(value) {
    return (typeof value === 'string' && SUPPORT_TYPES.includes(value));
}
function asOptionalTrimmedString(value, maxLen) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = (0, sanitizeInput_1.sanitizeInput)(value);
    if (!trimmed)
        return undefined;
    return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}
function asRequiredTrimmedString(value, maxLen) {
    if (typeof value !== 'string')
        return null;
    const trimmed = (0, sanitizeInput_1.sanitizeInput)(value);
    if (!trimmed)
        return null;
    return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}
function isValidEmail(email) {
    if (email.length > 254)
        return false;
    return email.includes('@');
}
router.post('/contact', rateLimiter_1.supportMessageLimiter, auth_1.optionalAuthMiddleware, async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const typeRaw = (_a = req.body) === null || _a === void 0 ? void 0 : _a.type;
        const subject = asRequiredTrimmedString((_b = req.body) === null || _b === void 0 ? void 0 : _b.subject, 200);
        const message = asRequiredTrimmedString((_c = req.body) === null || _c === void 0 ? void 0 : _c.message, 8000);
        const bodyEmail = (_e = asOptionalTrimmedString((_d = req.body) === null || _d === void 0 ? void 0 : _d.email, 254)) === null || _e === void 0 ? void 0 : _e.toLowerCase();
        const authedUserId = (0, getUserId_1.getUserId)(req);
        const userId = authedUserId;
        const contextUrl = asOptionalTrimmedString((_f = req.body) === null || _f === void 0 ? void 0 : _f.contextUrl, 2048);
        const userAgent = asOptionalTrimmedString((_g = req.body) === null || _g === void 0 ? void 0 : _g.userAgent, 512) ||
            asOptionalTrimmedString(req.get('User-Agent'), 512);
        if (!isSupportType(typeRaw)) {
            return res.status(400).json({ error: 'Invalid support message type' });
        }
        if (!subject || !message) {
            return res
                .status(400)
                .json({ error: 'Subject and message are required' });
        }
        if (bodyEmail && !isValidEmail(bodyEmail)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        let resolvedEmail = bodyEmail;
        if (authedUserId) {
            const user = await prisma_1.default.user.findUnique({
                where: { id: authedUserId },
                select: { email: true },
            });
            if (user === null || user === void 0 ? void 0 : user.email) {
                resolvedEmail = user.email.toLowerCase();
            }
        }
        if (!resolvedEmail) {
            return res.status(400).json({
                error: 'Email is required when not logged in',
            });
        }
        if (!isValidEmail(resolvedEmail)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        const payload = {
            type: typeRaw,
            subject,
            message,
            email: resolvedEmail,
            userId,
            contextUrl,
            userAgent,
        };
        const ip = (0, getUserIp_1.getUserIp)(req);
        const requestId = req.requestId;
        await (0, emailService_1.sendSupportMessageEmail)(payload, { ip, requestId });
        await (0, emailService_1.sendSupportConfirmationEmail)(payload.email, payload.type, payload.subject);
        return res.status(200).json({
            ok: true,
            message: 'Thank you — your message was received!',
        });
    }
    catch (error) {
        logger_1.logger.error({ error, userId: (0, getUserId_1.getUserId)(req) }, 'Error submitting support request');
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
