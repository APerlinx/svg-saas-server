"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const getUserId_1 = require("../utils/getUserId");
const logger_1 = require("../lib/logger");
const router = (0, express_1.Router)();
// Get all users
router.get('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const users = await prisma_1.default.user.findMany({
            select: {
                id: true,
                email: true,
                name: true,
                // Exclude passwordHash
            },
        });
        res.json(users);
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Error fetching users');
        res.status(500).json({ error: 'Internal server error' });
    }
});
// return user data (without passwordHash)
router.get('/me', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = (0, getUserId_1.requireUserId)(req);
        const user = await prisma_1.default.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                plan: true,
                credits: true,
                createdAt: true,
                updatedAt: true,
                generations: true,
                // passwordHash is excluded by not including it
            },
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user });
    }
    catch (error) {
        logger_1.logger.error({ error, userId: (0, getUserId_1.getUserId)(req) }, 'Error fetching user data');
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
