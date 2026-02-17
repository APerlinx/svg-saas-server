"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setRateLimitHeaders = setRateLimitHeaders;
/**
 * Sets rate limit headers on the response if quota info is available
 * @param req Express request object (with quotaInfo attached by apiQuotaLimit middleware)
 * @param res Express response object
 */
function setRateLimitHeaders(req, res) {
    const quotaInfo = req.quotaInfo;
    if (quotaInfo) {
        res.setHeader('X-RateLimit-Limit', quotaInfo.limit);
        res.setHeader('X-RateLimit-Remaining', quotaInfo.remaining);
        res.setHeader('X-RateLimit-Reset', quotaInfo.resetAt.toISOString());
    }
}
