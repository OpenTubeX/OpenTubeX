import { readFile } from 'node:fs/promises'
import { test, expect } from '../../helpers/app.mjs'

const source = await readFile(new URL('../../../src/datastores/browserSubscriptionCache.js', import.meta.url), 'utf8')

test.beforeEach(async ({ page }) => {
  // Exercise the browser backend against Chromium's real IndexedDB, including
  // transaction commits and structured cloning, without touching the app cache.
  await page.evaluate(`${source.replace('export function', 'function')}; window.createTestCache = createBrowserSubscriptionCache`)
})

test('refresh writes scale with one channel instead of the entire subscription cache', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const records = Array.from({ length: 938 }, (_, index) => ({
      _id: `channel-${index}`,
      videosTimestamp: new Date(1000),
      videos: Array.from({ length: 20 }, (_, video) => ({
        videoId: `${index}-${video}`, title: 'Video title '.repeat(30), isNewInSubscriptionFeed: true
      }))
    }))
    const cache = window.createTestCache(async () => records, 'cache-size-test')
    await cache.find()
    const original = IDBObjectStore.prototype.put
    const sizes = []
    IDBObjectStore.prototype.put = function (value, ...args) {
      sizes.push(JSON.stringify(value).length)
      return original.call(this, value, ...args)
    }
    const started = performance.now()
    try {
      await Promise.all(records.slice(0, 8).map(record => (
        cache.updateVideosByChannelId(record._id, record.videos, new Date(2000))
      )))
    } finally {
      IDBObjectStore.prototype.put = original
    }
    return { sizes, elapsedMs: performance.now() - started, count: (await cache.find()).length }
  })
  expect(result.count).toBe(938)
  expect(result.sizes).toHaveLength(8)
  expect(Math.max(...result.sizes)).toBeLessThan(20_000)
})

test('imports cached feeds once and keeps clear operations cleared after reopening', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const record = {
      _id: 'channel',
      videosTimestamp: new Date(1000),
      videos: [{ videoId: 'video', isNewInSubscriptionFeed: false }],
      shorts: [{ videoId: 'short', isNewInSubscriptionFeed: true }],
      liveStreams: [],
      communityPosts: [{ postId: 'post' }]
    }
    let imports = 0
    const load = async () => { imports++; return [record] }
    const cache = window.createTestCache(load, 'cache-import-test')
    const other = window.createTestCache(load, 'cache-import-test')
    const [first] = await Promise.all([cache.find(), other.find()])
    await cache.updateVideosByChannelId('channel', [{ videoId: 'new' }], new Date(2000))
    const reopened = window.createTestCache(load, 'cache-import-test')
    const persisted = await reopened.find()
    await cache.deleteAll()
    const cleared = await window.createTestCache(load, 'cache-import-test').find()
    return { first, persisted, cleared, imports }
  })
  expect(result.first[0].videos[0].isNewInSubscriptionFeed).toBe(false)
  expect(result.first[0].shorts[0].isNewInSubscriptionFeed).toBe(true)
  expect(result.first[0].communityPosts[0].postId).toBe('post')
  expect(result.persisted[0].videos[0].videoId).toBe('new')
  expect(result.persisted[0].shorts[0].videoId).toBe('short')
  expect(result.cleared).toEqual([])
  expect(result.imports).toBeLessThanOrEqual(2)
})

test('serializes competing feeds, stale writes and Shorts enrichment across connections', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const cache = window.createTestCache(async () => [], 'cache-race-test')
    const other = window.createTestCache(async () => [], 'cache-race-test')
    await Promise.all([cache.find(), other.find()])
    await Promise.all([
      cache.updateVideosByChannelId('channel', [{ videoId: 'video' }], new Date(3000)),
      other.updateShortsByChannelId('channel', [{ videoId: 'short', title: 'Original', viewCount: 100 }], new Date(1000))
    ])
    const stale = await other.updateVideosByChannelId('channel', [], new Date(2000))
    await Promise.all([
      cache.updateShortsByChannelId('channel', [{ videoId: 'short', title: 'Refreshed', viewCount: 100 }, { videoId: 'new-short' }], new Date(2000)),
      other.updateShortsWithChannelPageShortsByChannelId('channel', [{ videoId: 'short', title: 'Enriched', viewCount: 200 }])
    ])
    const records = await cache.find()
    await cache.deleteMultipleChannels(['channel'])
    return { stale, records, removed: await other.find() }
  })
  expect(result.stale).toBe(false)
  expect(result.records[0].videos[0].videoId).toBe('video')
  expect(result.records[0].shorts.map(video => video.videoId)).toEqual(['short', 'new-short'])
  expect(result.records[0].shorts[0].title).toBe('Enriched')
  expect(result.records[0].shorts[0].viewCount).toBe(200)
  expect(result.removed).toEqual([])
})

test('failed imports retry atomically and failed writes reject without losing cached data', async ({ page }) => {
  const result = await page.evaluate(async () => {
    let invalid = true
    const cache = window.createTestCache(async () => [
      { _id: 'channel', videos: [{ videoId: 'old' }], videosTimestamp: new Date(1000) },
      invalid ? { _id: 'invalid', uncloneable: () => {} } : { _id: 'second' }
    ], 'cache-failure-test')
    const importError = await cache.find().then(() => null, error => error.name)
    invalid = false
    const imported = await cache.find()
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('Simulated storage failure', 'QuotaExceededError')
    }
    let writeError
    try {
      writeError = await cache.updateVideosByChannelId('channel', [], new Date(2000))
        .then(() => null, error => error.name)
    } finally {
      IDBObjectStore.prototype.put = original
    }
    return { importError, writeError, imported, persisted: await cache.find() }
  })
  expect(result.importError).toBe('DataCloneError')
  expect(result.imported).toHaveLength(2)
  expect(result.writeError).toBe('QuotaExceededError')
  expect(result.persisted.find(record => record._id === 'channel').videos[0].videoId).toBe('old')
})

test('cleans up the old log after import and retries interrupted cleanup without reimporting', async ({ page }) => {
  const result = await page.evaluate(async () => {
    let imports = 0
    let cleanups = 0
    const load = async () => {
      imports++
      return [{ _id: 'channel', videos: [{ videoId: 'old' }] }]
    }
    const cleanup = async () => {
      cleanups++
      if (cleanups === 1) throw new Error('Interrupted cleanup')
    }
    const cache = window.createTestCache(load, 'cache-cleanup-test', cleanup)
    const error = await cache.find().then(() => null, error => error.message)
    const reopened = window.createTestCache(load, 'cache-cleanup-test', cleanup)
    const records = await reopened.find()
    await reopened.deleteAll()
    const cleared = await window.createTestCache(load, 'cache-cleanup-test', cleanup).find()
    return { error, records, cleared, imports, cleanups }
  })
  expect(result.error).toBe('Interrupted cleanup')
  expect(result.records[0].videos[0].videoId).toBe('old')
  expect(result.imports).toBe(1)
  expect(result.cleanups).toBe(2)
  expect(result.cleared).toEqual([])
})

test('snapshots reactive entries before awaiting storage and preserves other feed data', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const cache = window.createTestCache(async () => [], 'cache-proxy-test')
    const entry = { videoId: 'video', isNewInSubscriptionFeed: true }
    const entries = new Proxy([new Proxy(entry, {})], {})
    const update = cache.updateVideosByChannelId('channel', entries, new Date(1000))
    entry.isNewInSubscriptionFeed = false
    await update
    await cache.updateLiveStreamsByChannelId('channel', [{ videoId: 'live' }], new Date(1000))
    await cache.updateCommunityPostsByChannelId('channel', [{ postId: 'post' }], new Date(1000))
    return cache.find()
  })
  expect(result[0].videos[0].isNewInSubscriptionFeed).toBe(true)
  expect(result[0].liveStreams[0].videoId).toBe('live')
  expect(result[0].communityPosts[0].postId).toBe('post')
})
