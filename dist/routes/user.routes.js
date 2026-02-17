"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const Sentry = __importStar(require("@sentry/node"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const getUserId_1 = require("../utils/getUserId");
const logger_1 = require("../lib/logger");
const svgStyles_1 = require("../constants/svgStyles");
const models_1 = require("../constants/models");
const env_1 = require("../config/env");
const s3_1 = require("../lib/s3");
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
router.get('/generations', auth_1.authMiddleware, async (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(rawLimit, 1), 100)
        : 50;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : undefined;
    const style = typeof req.query.style === 'string' ? req.query.style.trim() : undefined;
    const model = typeof req.query.model === 'string' ? req.query.model.trim() : undefined;
    const rawPrivacy = typeof req.query.privacy === 'string'
        ? req.query.privacy.trim().toLowerCase()
        : undefined;
    const isFirstPage = !cursor;
    const buildSvgUrl = async (s3Key, isPrivate) => {
        if (!s3Key)
            return null;
        // Private SVGs: use pre-signed URLs with expiration
        if (isPrivate) {
            try {
                return await (0, s3_1.getDownloadUrl)(s3Key, 15 * 60); // 15 minutes
            }
            catch (error) {
                logger_1.logger.error({ error, s3Key }, 'Failed to generate pre-signed URL');
                return null;
            }
        }
        // Public SVGs: use CloudFront URLs (permanent, shareable)
        if (!env_1.PUBLIC_ASSETS_BASE_URL)
            return null;
        return `${env_1.PUBLIC_ASSETS_BASE_URL}/${s3Key}`;
    };
    try {
        const userId = (0, getUserId_1.requireUserId)(req);
        if (style && !svgStyles_1.VALID_SVG_STYLES.includes(style)) {
            return res.status(400).json({
                error: `Invalid style. Must be one of: ${svgStyles_1.VALID_SVG_STYLES.join(', ')}`,
            });
        }
        if (model && !models_1.VALID_MODELS.includes(model)) {
            return res.status(400).json({
                error: `Invalid model. Must be one of: ${models_1.VALID_MODELS.join(', ')}`,
            });
        }
        let privacyWhere = {};
        if (rawPrivacy && rawPrivacy !== 'all') {
            if (rawPrivacy === 'public' || rawPrivacy === 'false') {
                privacyWhere = { privacy: false };
            }
            else if (rawPrivacy === 'private' || rawPrivacy === 'true') {
                privacyWhere = { privacy: true };
            }
            else {
                return res.status(400).json({
                    error: 'Invalid privacy. Must be one of: all, public, private',
                    errorCode: 'INVALID_PRIVACY',
                });
            }
        }
        const where = {
            userId,
            ...(style ? { style } : {}),
            ...(model ? { model } : {}),
            ...privacyWhere,
        };
        const fetchPage = async (pageCursor) => {
            const generations = await prisma_1.default.svgGeneration.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: limit + 1,
                ...(pageCursor ? { cursor: { id: pageCursor }, skip: 1 } : {}),
                select: {
                    id: true,
                    prompt: true,
                    style: true,
                    model: true,
                    privacy: true,
                    creditsUsed: true,
                    createdAt: true,
                    s3Key: true,
                },
            });
            const hasMore = generations.length > limit;
            const items = hasMore ? generations.slice(0, -1) : generations;
            const nextCursor = hasMore ? items[items.length - 1].id : null;
            const generationsWithUrls = await Promise.all(items.map(async (g) => ({
                id: g.id,
                prompt: g.prompt,
                style: g.style,
                model: g.model,
                privacy: g.privacy,
                creditsUsed: g.creditsUsed,
                createdAt: g.createdAt,
                svgUrl: await buildSvgUrl(g.s3Key, g.privacy),
            })));
            return {
                generations: generationsWithUrls,
                nextCursor,
            };
        };
        if (isFirstPage) {
            return res.json(await fetchPage(undefined));
        }
        return res.json(await fetchPage(cursor));
    }
    catch (error) {
        if (cursor &&
            error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2025') {
            return res.status(400).json({
                error: 'Invalid cursor',
                errorCode: 'INVALID_CURSOR',
            });
        }
        logger_1.logger.error({ error, userId: (0, getUserId_1.getUserId)(req) }, 'Error fetching SVG history');
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.delete('/generations/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = (0, getUserId_1.requireUserId)(req);
        const generationId = req.params.id;
        if (typeof generationId !== 'string' || !generationId.trim()) {
            return res.status(400).json({ error: 'Invalid generation id' });
        }
        let s3Key;
        const generation = await prisma_1.default.svgGeneration.findFirst({
            where: { id: generationId, userId },
            select: { s3Key: true },
        });
        s3Key = generation === null || generation === void 0 ? void 0 : generation.s3Key;
        if (!generation) {
            return res.status(404).json({ error: 'SVG generation not found' });
        }
        const deleteResult = await prisma_1.default.svgGeneration.deleteMany({
            where: { id: generationId, userId },
        });
        if (deleteResult.count !== 1) {
            logger_1.logger.warn({ generationId, userId, s3Key, deleteCount: deleteResult.count }, 'DB delete returned unexpected count for SVG generation');
            if (env_1.IS_PRODUCTION && process.env.SENTRY_DSN) {
                Sentry.captureMessage('DB delete returned unexpected count for SVG generation', {
                    level: 'warning',
                    tags: {
                        feature: 'delete_generation',
                        phase: 'db_delete',
                    },
                    extra: {
                        generationId,
                        userId,
                        s3Key,
                        deleteCount: deleteResult.count,
                    },
                });
            }
            return res.status(404).json({ error: 'SVG generation not found' });
        }
        if (env_1.IS_S3_ENABLED && generation.s3Key) {
            try {
                await (0, s3_1.deleteSvg)(generation.s3Key);
            }
            catch (error) {
                logger_1.logger.error({ error, generationId, userId, s3Key: generation.s3Key }, 'Failed to delete SVG from S3 after DB deletion');
                if (env_1.IS_PRODUCTION && process.env.SENTRY_DSN) {
                    Sentry.captureException(error, {
                        tags: {
                            feature: 'delete_generation',
                            phase: 's3_delete',
                        },
                        extra: {
                            generationId,
                            userId,
                            s3Key: generation.s3Key,
                        },
                    });
                }
            }
        }
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error({ error, userId: (0, getUserId_1.getUserId)(req) }, 'Error deleting SVG generation');
        if (env_1.IS_PRODUCTION && process.env.SENTRY_DSN) {
            Sentry.captureException(error, {
                tags: {
                    feature: 'delete_generation',
                    phase: 'handler',
                },
                extra: {
                    generationId: req.params.id,
                    userId: (0, getUserId_1.getUserId)(req),
                },
            });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
