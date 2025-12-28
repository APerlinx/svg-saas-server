"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cache = exports.RedisCache = void 0;
const logger_1 = require("./logger");
const redis_1 = require("./redis");
class RedisCache {
    constructor(args) {
        var _a;
        this.client = args.client;
        this.prefix = (_a = args.prefix) !== null && _a !== void 0 ? _a : 'cache:';
        this.defaultTtlSeconds = args.defaultTtlSeconds;
    }
    buildKey(...parts) {
        return parts
            .filter((p) => p !== null && p !== undefined)
            .map((p) => String(p))
            .join(':');
    }
    fullKey(key) {
        return `${this.prefix}${key}`;
    }
    canUseRedis() {
        if (this.client.isOpen === undefined)
            return true;
        return this.client.isOpen;
    }
    async getJsonWithHit(key) {
        if (!this.canUseRedis())
            return { hit: false, value: null };
        const redisKey = this.fullKey(key);
        try {
            const raw = await this.client.get(redisKey);
            if (raw === null)
                return { hit: false, value: null };
            return { hit: true, value: JSON.parse(raw) };
        }
        catch (error) {
            logger_1.logger.debug({ error, key: redisKey }, 'Cache getJson failed; returning miss');
            return { hit: false, value: null };
        }
    }
    async getJson(key) {
        const { value } = await this.getJsonWithHit(key);
        return value;
    }
    async setJson(key, value, options) {
        var _a;
        if (!this.canUseRedis())
            return;
        const redisKey = this.fullKey(key);
        const ttlSeconds = (_a = options === null || options === void 0 ? void 0 : options.ttlSeconds) !== null && _a !== void 0 ? _a : this.defaultTtlSeconds;
        try {
            const raw = JSON.stringify(value);
            if (ttlSeconds && ttlSeconds > 0) {
                await this.client.set(redisKey, raw, { EX: ttlSeconds });
            }
            else {
                await this.client.set(redisKey, raw);
            }
        }
        catch (error) {
            logger_1.logger.debug({ error, key: redisKey }, 'Cache setJson failed; ignoring');
        }
    }
    async del(keys) {
        if (!this.canUseRedis())
            return 0;
        // Convert single key to array for consistency
        const arr = Array.isArray(keys) ? keys : [keys];
        if (arr.length === 0)
            return 0;
        try {
            const full = arr.map((k) => this.fullKey(k));
            return await this.client.del(...full);
        }
        catch (error) {
            logger_1.logger.debug({ error, keys: arr }, 'Cache del failed; ignoring');
            return 0;
        }
    }
    async getOrSetJson(key, fetcher, options) {
        var _a;
        const { hit, value: cached } = await this.getJsonWithHit(key);
        if (hit) {
            logger_1.logger.debug({ key: this.fullKey(key) }, 'Cache hit');
            return cached;
        }
        logger_1.logger.debug({ key: this.fullKey(key) }, 'Cache miss');
        const value = await fetcher();
        const cacheNull = (_a = options === null || options === void 0 ? void 0 : options.cacheNull) !== null && _a !== void 0 ? _a : false;
        if (value !== null || cacheNull) {
            await this.setJson(key, value, options);
        }
        return value;
    }
}
exports.RedisCache = RedisCache;
exports.cache = new RedisCache({
    client: redis_1.redisClient, // The Redis client from redis.ts
    prefix: 'svg-saas:', // All keys will start with "svg-saas:"
    defaultTtlSeconds: 60, // Cache entries expire after 60 seconds by default
});
