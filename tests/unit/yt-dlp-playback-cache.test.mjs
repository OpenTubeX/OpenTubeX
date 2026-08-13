import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getEarliestYtDlpFormatExpiry,
  YtDlpPlaybackSourceCache
} from '../../src/renderer/helpers/player/ytDlpPlaybackCache.js'

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

test('reuses DASH sources until the early expiry margin', () => {
  let now = 1000000
  const cache = new YtDlpPlaybackSourceCache({
    expiryMarginMs: 120000,
    now: () => now
  })
  const cachedSource = source(new Date(now + 300000))

  cache.set('video', cachedSource)
  assert.equal(cache.get('video'), cachedSource)

  now += 180000
  assert.equal(cache.get('video'), null)
})

test('does not cache sources without a safely usable expiry', () => {
  const now = 1000000
  const cache = new YtDlpPlaybackSourceCache({
    expiryMarginMs: 120000,
    now: () => now
  })

  cache.set('missing-expiry', source(null))
  cache.set('near-expiry', source(new Date(now + 60000)))

  assert.equal(cache.get('missing-expiry'), null)
  assert.equal(cache.get('near-expiry'), null)
})

test('evicts the least recently used source at the size limit', () => {
  const cache = new YtDlpPlaybackSourceCache({ maxEntries: 2, now: () => 0 })
  const first = source(new Date(1000000))
  const second = source(new Date(1000000))
  const third = source(new Date(1000000))

  cache.set('first', first)
  cache.set('second', second)
  cache.get('first')
  cache.set('third', third)

  assert.equal(cache.get('first'), first)
  assert.equal(cache.get('second'), null)
  assert.equal(cache.get('third'), third)
})

test('invalidates a source after a playback error', () => {
  const cache = new YtDlpPlaybackSourceCache({ now: () => 0 })
  cache.set('video', source(new Date(1000000)))

  cache.delete('video')

  assert.equal(cache.get('video'), null)
})
