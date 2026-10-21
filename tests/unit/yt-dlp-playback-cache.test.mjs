import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compileFunction } from 'node:vm'

import {
  getEarliestYtDlpFormatExpiry,
  YtDlpPlaybackSourceCache
} from '../../src/renderer/helpers/player/ytDlpPlaybackCache.js'
import {
  DEFAULT_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB,
  normalizeYtDlpPlaybackCacheMaxEntrySize
} from '../../src/ytDlpPlaybackCacheSettings.js'

function source (expiryDate) {
  return { expiryDate }
}

test('uses the earliest expiry from the yt-dlp formats', () => {
  assert.deepEqual(getEarliestYtDlpFormatExpiry([
    { url: 'https://example.com/videoplayback?expire=2000' },
    { url: 'https://example.com/videoplayback?expire=1000' },
    { url: 'https://example.com/videoplayback' }
  ]), new Date(1000 * 1000))
})

test('reads the expiry from a yt-dlp HLS manifest path', () => {
  assert.deepEqual(getEarliestYtDlpFormatExpiry([{
    url: 'https://example.com/api/manifest/hls_playlist/expire/2000/master.m3u8'
  }]), new Date(2000 * 1000))
})

test('normalizes the persistent playback cache entry size', () => {
  assert.equal(normalizeYtDlpPlaybackCacheMaxEntrySize(4), 4)
  assert.equal(normalizeYtDlpPlaybackCacheMaxEntrySize('8'), 8)
  assert.equal(normalizeYtDlpPlaybackCacheMaxEntrySize(0), 0)
  assert.equal(
    normalizeYtDlpPlaybackCacheMaxEntrySize(-1),
    DEFAULT_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB
  )
  assert.equal(
    normalizeYtDlpPlaybackCacheMaxEntrySize(17),
    DEFAULT_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB
  )
  assert.equal(
    normalizeYtDlpPlaybackCacheMaxEntrySize(1.5),
    DEFAULT_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB
  )
})

test('reuses DASH sources until the early expiry margin', () => {
  let now = 1000000
  const cache = new YtDlpPlaybackSourceCache({
    expiryMarginMs: 120000,
    now: () => now
  })
  const cachedSource = source(new Date(now + 300000))

  cache.set('video', 'settings', cachedSource)
  assert.equal(cache.get('video', 'settings'), cachedSource)

  now += 180000
  assert.equal(cache.get('video', 'settings'), null)
})

test('does not cache sources without a safely usable expiry', () => {
  const now = 1000000
  const cache = new YtDlpPlaybackSourceCache({
    expiryMarginMs: 120000,
    now: () => now
  })

  cache.set('missing-expiry', 'settings', source(null))
  cache.set('near-expiry', 'settings', source(new Date(now + 60000)))

  assert.equal(cache.get('missing-expiry', 'settings'), null)
  assert.equal(cache.get('near-expiry', 'settings'), null)
})

test('does not cache a playable source from incomplete extraction', () => {
  const cache = new YtDlpPlaybackSourceCache({ now: () => 0 })
  assert.equal(cache.set('partial', 'settings', {
    ...source(new Date(1000000)),
    isLive: false,
    incomplete: true
  }), false)
  assert.equal(cache.get('partial', 'settings'), null)
})

test('evicts the least recently used source at the size limit', () => {
  const cache = new YtDlpPlaybackSourceCache({ maxEntries: 2, now: () => 0 })
  const first = source(new Date(1000000))
  const second = source(new Date(1000000))
  const third = source(new Date(1000000))

  cache.set('first', 'settings', first)
  cache.set('second', 'settings', second)
  cache.get('first', 'settings')
  cache.set('third', 'settings', third)

  assert.equal(cache.get('first', 'settings'), first)
  assert.equal(cache.get('second', 'settings'), null)
  assert.equal(cache.get('third', 'settings'), third)
})

test('can reserve enough in-memory entries for an explicit playlist preload', () => {
  const cache = new YtDlpPlaybackSourceCache({ maxEntries: 2, now: () => 0 })
  cache.ensureCapacity(3)

  cache.set('first', 'settings', source(new Date(1000000)))
  cache.set('second', 'settings', source(new Date(1000000)))
  cache.set('third', 'settings', source(new Date(1000000)))

  assert.equal(cache.get('first', 'settings').expiryDate.getTime(), 1000000)
  assert.equal(cache.get('second', 'settings').expiryDate.getTime(), 1000000)
  assert.equal(cache.get('third', 'settings').expiryDate.getTime(), 1000000)
})

test('reports when a cached source stops being safely reusable', () => {
  let now = 1000000
  const cache = new YtDlpPlaybackSourceCache({
    expiryMarginMs: 120000,
    now: () => now
  })
  cache.set('video', 'settings', {
    ...source(new Date(now + 300000)),
    subtitlesIncluded: true
  })

  assert.equal(cache.getUsableUntil('video', 'settings', true), now + 180000)
  now += 180000
  assert.equal(cache.getUsableUntil('video', 'settings', true), null)
})

test('reports when a preloaded source is evicted', () => {
  const cache = new YtDlpPlaybackSourceCache({ maxEntries: 1, now: () => 0 })
  cache.set('playlist-video', 'settings', source(new Date(1000000)))
  assert.equal(cache.getUsableUntil('playlist-video', 'settings'), 880000)

  cache.set('other-video', 'settings', source(new Date(1000000)))
  assert.equal(cache.getUsableUntil('playlist-video', 'settings'), null)
})

test('does not reuse sources extracted with different settings', () => {
  const cache = new YtDlpPlaybackSourceCache({ now: () => 0 })
  cache.set('video', 'old-settings', source(new Date(1000000)))

  assert.equal(cache.get('video', 'new-settings'), null)
})

test('invalidates a source after a playback error', () => {
  const cache = new YtDlpPlaybackSourceCache({ now: () => 0 })
  cache.set('video', 'settings', source(new Date(1000000)))

  cache.delete('video')

  assert.equal(cache.get('video', 'settings'), null)
})

test('clears every source after the managed binary is updated', () => {
  const cache = new YtDlpPlaybackSourceCache({ now: () => 0 })
  cache.set('first', 'settings', source(new Date(1000000)))
  cache.set('second', 'settings', source(new Date(1000000)))

  cache.clear()

  assert.equal(cache.get('first', 'settings'), null)
  assert.equal(cache.get('second', 'settings'), null)
})

test('drops expired sources that were never read again when caching another one', () => {
  let now = 1000000
  const cache = new YtDlpPlaybackSourceCache({ expiryMarginMs: 0, now: () => now })
  cache.ensureCapacity(100)
  for (let index = 0; index < 100; index++) {
    cache.set(`preloaded-${index}`, 'settings', source(new Date(now + 1000)))
  }

  now += 1000
  cache.set('video', 'settings', source(new Date(now + 1000)))

  assert.deepEqual([...cache.sources.keys()], ['video'])
})

test('caching a large playlist preload does not recheck every source on each write', () => {
  let now = 1000000
  let expiryReads = 0
  class CountedDate extends Date {
    getTime() {
      expiryReads++
      return super.getTime()
    }
  }
  const cache = new YtDlpPlaybackSourceCache({ expiryMarginMs: 0, now: () => now })
  cache.ensureCapacity(5000)
  for (let index = 0; index < 5000; index++) {
    cache.set(`preloaded-${index}`, 'settings', source(new CountedDate(now + 60_000 + index)))
  }
  assert.ok(expiryReads < 5 * 5000, `${expiryReads} expiry reads`)

  // Once a source expires, the next write removes it.
  now += 60_000
  cache.set('video', 'settings', source(new Date(now + 60_000)))
  assert.equal(cache.sources.has('preloaded-0'), false)
  assert.equal(cache.sources.has('preloaded-1'), true)
})

async function loadPersistentCache (directory, stringified) {
  const source = (await readFile(new URL('../../src/main/ytDlpPlaybackCache.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace(/^export (?=(async )?function)/gm, '')
  const dependencies = {
    app: { getPath: () => directory },
    Buffer,
    createHash,
    readFile,
    rename,
    rm,
    writeFile,
    join,
    settings: { _findOne: async () => ({ value: DEFAULT_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB }) },
    DEFAULT_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB,
    normalizeYtDlpPlaybackCacheMaxEntrySize,
    TabManager: { getOpenVideoIds: () => new Set() },
    isOpenTubeXUrl: () => true,
    // Counts serialized entries; the whole-file write passes an array.
    JSON: { parse: JSON.parse, stringify: value => { if (!Array.isArray(value)) stringified.push(value.videoId); return JSON.stringify(value) } },
  }
  return compileFunction(`${source}\nreturn { handleYtDlpPlaybackCacheGet, handleYtDlpPlaybackCacheSet, applyYtDlpPlaybackCacheSettings }`, Object.keys(dependencies))(...Object.values(dependencies))
}

test('persistent cache entries are measured once and stored in the same file format', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-ytdlp-cache-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const event = { senderFrame: { url: 'app://bundle/index.html' } }
  const playbackSource = { manifestSrc: 'data:application/dash+xml;base64,PE1QRD4=', manifestMimeType: 'application/dash+xml', legacyFormats: [], title: null, isLive: false }
  const expiryTime = Date.now() + 60 * 60 * 1000
  const stringified = []
  const cache = await loadPersistentCache(directory, stringified)
  await cache.applyYtDlpPlaybackCacheSettings()
  assert.equal(await cache.handleYtDlpPlaybackCacheSet(event, 'aaaaaaaaaaa', 'key', expiryTime, playbackSource), true)
  assert.equal(await cache.handleYtDlpPlaybackCacheSet(event, 'bbbbbbbbbbb', 'key', expiryTime, playbackSource), true)
  assert.deepEqual(stringified, ['aaaaaaaaaaa', 'bbbbbbbbbbb'], 'each new entry is serialized once to measure it')
  await cache.applyYtDlpPlaybackCacheSettings()
  assert.equal(stringified.length, 2, 'revalidating stored entries reuses their sizes')

  const stored = JSON.parse(await readFile(join(directory, 'yt-dlp-playback-cache.json'), 'utf8'))
  assert.deepEqual(stored.map(entry => Object.keys(entry)), [['videoId', 'cacheKeyHash', 'expiryTime', 'source'], ['videoId', 'cacheKeyHash', 'expiryTime', 'source']])

  const reloaded = []
  const restarted = await loadPersistentCache(directory, reloaded)
  await restarted.applyYtDlpPlaybackCacheSettings()
  assert.deepEqual(reloaded, ['aaaaaaaaaaa', 'bbbbbbbbbbb'], 'loading measures each stored entry once')
  assert.equal((await restarted.handleYtDlpPlaybackCacheGet(event, 'aaaaaaaaaaa', 'key')).source.manifestSrc, playbackSource.manifestSrc)
  assert.equal(reloaded.length, 2)
})

test('playback does not wait for the persistent cache write and still reports failures', async () => {
  const code = await readFile(new URL('../../src/renderer/helpers/player/ytDlpPlayback.js', import.meta.url), 'utf8')
  const start = code.indexOf('async function cacheYtDlpPlaybackSource(')
  const functionSource = code.slice(start, code.indexOf('\n}\n', start) + 2)
  const writes = []
  const warnings = []
  let rejectWrite
  const dependencies = {
    playbackSourceCache: { set: () => false },
    notifyPlaybackSourceCacheChanged: () => {},
    ytDlp: { ytDlpPlaybackCacheSet: (...args) => { writes.push(args); return new Promise((resolve, reject) => { rejectWrite = reject }) } },
    console: { warn: (...args) => warnings.push(args) },
  }
  const cacheSource = compileFunction(`${functionSource}\nreturn cacheYtDlpPlaybackSource`, Object.keys(dependencies))(...Object.values(dependencies))
  const expiryDate = new Date(Date.now() + 60 * 60 * 1000)
  const settled = await Promise.race([
    cacheSource('aaaaaaaaaaa', 'key', { isLive: false, expiryDate }).then(() => true),
    new Promise(resolve => setImmediate(() => resolve(false))),
  ])
  assert.equal(settled, true, 'the source is returned while the write is still pending')
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].slice(0, 3), ['aaaaaaaaaaa', 'key', expiryDate.getTime()])
  rejectWrite(new Error('Disk full'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0][1].message, 'Disk full')
})
