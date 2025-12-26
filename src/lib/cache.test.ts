import { RedisCache, CacheRedisClient } from './cache'

type FakeRedis = CacheRedisClient & { store: Map<string, string> }

function createFakeRedis(): FakeRedis {
  const store = new Map<string, string>()
  return {
    isOpen: true,
    store,
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    async set(key: string, value: string) {
      store.set(key, value)
      return 'OK'
    },
    async del(...keys: string[]) {
      let deleted = 0
      for (const k of keys) {
        if (store.delete(k)) deleted++
      }
      return deleted
    },
  }
}

describe('RedisCache', () => {
  // Ensures getOrSetJson caches on first call and returns cached value on the second call.
  test('getOrSetJson caches result on miss and serves hit next time', async () => {
    const fake = createFakeRedis()
    const cache = new RedisCache({ client: fake, prefix: 'test:' })

    const key = cache.buildKey('public', 'page', 1, 'limit', 10)
    let calls = 0

    const first = await cache.getOrSetJson(key, async () => {
      calls += 1
      return { ok: true }
    })

    const second = await cache.getOrSetJson(key, async () => {
      calls += 1
      return { ok: false }
    })

    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })
    expect(calls).toBe(1)
  })

  // Ensures del removes keys and subsequent get returns null (cache miss).
  test('del removes cached keys', async () => {
    const fake = createFakeRedis()
    const cache = new RedisCache({ client: fake, prefix: 'test:' })

    await cache.setJson('k1', { a: 1 })
    const deleted = await cache.del('k1')

    expect(deleted).toBe(1)
    expect(await cache.getJson('k1')).toBeNull()
  })

  // Ensures cacheNull option caches null values, so a later call still returns null.
  test('respects cacheNull option when value is null', async () => {
    const fake = createFakeRedis()
    const cache = new RedisCache({ client: fake, prefix: 'test:' })
    const key = 'nullable'

    const first = await cache.getOrSetJson(key, async () => null, {
      cacheNull: true,
    })
    const second = await cache.getOrSetJson(
      key,
      async () => ({
        unexpected: true,
      }),
      {
        cacheNull: true,
      }
    )

    expect(first).toBeNull()
    expect(second).toBeNull()
  })
})
