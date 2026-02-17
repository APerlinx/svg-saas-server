"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const getUserId_1 = require("../utils/getUserId");
const prisma_1 = __importDefault(require("../lib/prisma"));
const router = (0, express_1.Router)();
router.get('/latest', auth_1.authMiddleware, async (req, res) => {
    var _a;
    const userId = (0, getUserId_1.requireUserId)(req);
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(rawLimit, 1), 100)
        : 5;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    try {
        const notifications = await prisma_1.default.notification.findMany({
            where: { userId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: {
                id: true,
                type: true,
                title: true,
                message: true,
                data: true,
                createdAt: true,
                readAt: true,
            },
        });
        const hasMore = notifications.length > limit;
        const items = hasMore ? notifications.slice(0, -1) : notifications;
        const nextCursor = hasMore ? (_a = items[items.length - 1]) === null || _a === void 0 ? void 0 : _a.id : null;
        return res.json({ notifications: items, nextCursor });
    }
    catch {
        return res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});
router.get('/badge', auth_1.authMiddleware, async (req, res) => {
    const userId = (0, getUserId_1.requireUserId)(req);
    try {
        const user = await prisma_1.default.user.findUnique({
            where: { id: userId },
            select: { notificationsLastSeenAt: true },
        });
        const lastSeenAt = user === null || user === void 0 ? void 0 : user.notificationsLastSeenAt;
        const unreadCount = await prisma_1.default.notification.count({
            where: {
                userId,
                ...(lastSeenAt ? { createdAt: { gt: lastSeenAt } } : {}),
            },
        });
        return res.json({ unreadCount });
    }
    catch {
        return res.status(500).json({ error: 'Failed to fetch unread counts' });
    }
});
router.post('/seen', auth_1.authMiddleware, async (req, res) => {
    const userId = (0, getUserId_1.requireUserId)(req);
    try {
        await prisma_1.default.user.update({
            where: { id: userId },
            data: { notificationsLastSeenAt: new Date() },
        });
        return res.json({ ok: true });
    }
    catch {
        return res
            .status(500)
            .json({ error: 'Failed to mark notifications as seen' });
    }
});
exports.default = router;
