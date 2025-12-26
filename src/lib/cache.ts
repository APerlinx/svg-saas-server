import { logger } from './logger'
import { redisClient } from './redis'

export type CacheKey = string
export interface CacheRedisClient {
  isOpen?: boolean // true if connected, false if disconnected
  get(key: string): Promise<string | null> // Get value by key (Redis GET command)
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown> // Set value with optional expiry in seconds (Redis SET command with EX option)
  del(...keys: string[]): Promise<number> // Delete keys and return count deleted (Redis DEL command)
}

// Options you can pass when SETTING cache
export interface CacheSetOptions {
  ttlSeconds?: number // ttl = Time to live
}

// Options for the getOrSetJson pattern
export interface CacheGetOrSetOptions extends CacheSetOptions {
  cacheNull?: boolean // If true, we'll cache null values too (useful for "not found" caching)
}

export class RedisCache {
  private readonly client: CacheRedisClient
  private readonly prefix: string
  private readonly defaultTtlSeconds?: number

  constructor(args: {
    client: CacheRedisClient
    prefix?: string
    defaultTtlSeconds?: number
  }) {
    this.client = args.client
    this.prefix = args.prefix ?? 'cache:'
    this.defaultTtlSeconds = args.defaultTtlSeconds
  }

  buildKey(
    ...parts: Array<string | number | boolean | null | undefined>
  ): CacheKey {
    return parts
      .filter((p) => p !== null && p !== undefined)
      .map((p) => String(p))
      .join(':')
  }

  private fullKey(key: CacheKey): string {
    return `${this.prefix}${key}`
  }

  private canUseRedis(): boolean {
    if (this.client.isOpen === undefined) return true
    return this.client.isOpen
  }

  async getJsonWithHit<T>(
    key: CacheKey
  ): Promise<{ hit: boolean; value: T | null }> {
    if (!this.canUseRedis()) return { hit: false, value: null }

    const redisKey = this.fullKey(key)

    try {
      const raw = await this.client.get(redisKey)

      if (raw === null) return { hit: false, value: null }

      return { hit: true, value: JSON.parse(raw) as T }
    } catch (error) {
      logger.debug(
        { error, key: redisKey },
        'Cache getJson failed; returning miss'
      )
      return { hit: false, value: null }
    }
  }

  async getJson<T>(key: CacheKey): Promise<T | null> {
    const { value } = await this.getJsonWithHit<T>(key)
    return value
  }

  async setJson<T>(
    key: CacheKey,
    value: T,
    options?: CacheSetOptions
  ): Promise<void> {
    if (!this.canUseRedis()) return

    const redisKey = this.fullKey(key)
    const ttlSeconds = options?.ttlSeconds ?? this.defaultTtlSeconds

    try {
      const raw = JSON.stringify(value)

      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(redisKey, raw, { EX: ttlSeconds })
      } else {
        await this.client.set(redisKey, raw)
      }
    } catch (error) {
      logger.debug({ error, key: redisKey }, 'Cache setJson failed; ignoring')
    }
  }

  async del(keys: CacheKey | CacheKey[]): Promise<number> {
    if (!this.canUseRedis()) return 0

    // Convert single key to array for consistency
    const arr = Array.isArray(keys) ? keys : [keys]
    if (arr.length === 0) return 0

    try {
      const full = arr.map((k) => this.fullKey(k))

      return await this.client.del(...full)
    } catch (error) {
      logger.debug({ error, keys: arr }, 'Cache del failed; ignoring')
      return 0
    }
  }

  async getOrSetJson<T>(
    key: CacheKey,
    fetcher: () => Promise<T>,
    options?: CacheGetOrSetOptions
  ): Promise<T> {
    const { hit, value: cached } = await this.getJsonWithHit<T>(key)

    if (hit) {
      logger.debug({ key: this.fullKey(key) }, 'Cache hit')
      return cached as T
    }

    logger.debug({ key: this.fullKey(key) }, 'Cache miss')
    const value = await fetcher()

    const cacheNull = options?.cacheNull ?? false

    if (value !== null || cacheNull) {
      await this.setJson(key, value, options)
    }

    return value
  }
}

export const cache = new RedisCache({
  client: redisClient, // The Redis client from redis.ts
  prefix: 'svg-saas:', // All keys will start with "svg-saas:"
  defaultTtlSeconds: 60, // Cache entries expire after 60 seconds by default
})
