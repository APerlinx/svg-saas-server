"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeAllUserTokens = exports.revokeRefreshToken = exports.verifyAndRotateRefreshToken = exports.createRefreshToken = exports.generateRefreshToken = void 0;
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = require("../lib/logger");
const sha256 = (value) => crypto_1.default.createHash('sha256').update(value).digest('hex');
const generateRefreshToken = () => {
    // Prefer base64url to keep cookie smaller than hex (optional but better)
    // Node 20+: crypto.randomBytes(32).toString('base64url')
    const plainToken = crypto_1.default.randomBytes(32).toString('hex');
    return { plainToken, hashedToken: sha256(plainToken) };
};
exports.generateRefreshToken = generateRefreshToken;
const createRefreshToken = async (userId, expiresInDays = 30, ipAddress, userAgent, familyId, tx) => {
    const db = tx !== null && tx !== void 0 ? tx : prisma_1.default;
    const { plainToken, hashedToken } = (0, exports.generateRefreshToken)();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    const created = await db.refreshToken.create({
        data: {
            token: hashedToken,
            userId,
            expiresAt,
            ipAddress,
            userAgent,
            familyId: familyId !== null && familyId !== void 0 ? familyId : undefined,
        },
    });
    return { plainToken, record: created };
};
exports.createRefreshToken = createRefreshToken;
const verifyAndRotateRefreshToken = async (oldPlainToken, expiresInDays = 7, ipAddress, userAgent) => {
    const hashedOld = sha256(oldPlainToken);
    const now = new Date();
    return prisma_1.default.$transaction(async (tx) => {
        const tokenRecord = await tx.refreshToken.findUnique({
            where: { token: hashedOld },
        });
        if (!tokenRecord)
            return { ok: false, reason: 'NOT_FOUND' };
        if (tokenRecord.expiresAt < now)
            return { ok: false, reason: 'EXPIRED' };
        // Reuse detection: token already revoked but someone is presenting it again
        if (tokenRecord.revokedAt) {
            logger_1.logger.warn({
                userId: tokenRecord.userId,
                familyId: tokenRecord.familyId,
                ipAddress,
                userAgent,
            }, 'Token reuse detected - revoking entire family');
            // Revoke the whole family
            await tx.refreshToken.updateMany({
                where: {
                    userId: tokenRecord.userId,
                    familyId: tokenRecord.familyId,
                    revokedAt: null,
                },
                data: { revokedAt: now },
            });
            return { ok: false, reason: 'REUSED' };
        }
        // Create replacement token in same family
        const { plainToken: newPlainToken, record: newRecord } = await (0, exports.createRefreshToken)(tokenRecord.userId, expiresInDays, ipAddress, userAgent, tokenRecord.familyId, tx);
        // Revoke old token and link it to the replacement
        await tx.refreshToken.update({
            where: { id: tokenRecord.id },
            data: {
                revokedAt: now,
                replacedByTokenId: newRecord.id,
                lastUsedAt: now,
            },
        });
        return { ok: true, userId: tokenRecord.userId, newPlainToken };
    });
};
exports.verifyAndRotateRefreshToken = verifyAndRotateRefreshToken;
const revokeRefreshToken = async (plainToken) => {
    const hashed = sha256(plainToken);
    await prisma_1.default.refreshToken.updateMany({
        where: { token: hashed, revokedAt: null },
        data: { revokedAt: new Date() },
    });
};
exports.revokeRefreshToken = revokeRefreshToken;
const revokeAllUserTokens = async (userId) => {
    await prisma_1.default.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
    });
};
exports.revokeAllUserTokens = revokeAllUserTokens;
