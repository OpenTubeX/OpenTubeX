import assert from 'node:assert/strict'
import test from 'node:test'

import { extractExpiryTimestamp, ImageCache } from '../../src/main/ImageCache.js'

const now = Math.trunc(Date.now() / 1000)

test('an unparsable Expires header falls back to the default lifetime instead of never expiring', (t) => {
  // Freeze the clock so a second boundary cannot pass between `now` and the call.
  t.mock.timers.enable({ apis: ['Date'], now: now * 1000 })
  for (const expires of ['never', '']) {
    const expiry = extractExpiryTimestamp({ expires })
    assert.ok(Number.isFinite(expiry), `Expires: ${JSON.stringify(expires)} produced ${expiry}`)
    assert.ok(expiry > now && expiry <= now + 7200 + 1)
  }
  for (const expires of ['-1', '0']) {
    // V8 parses these as dates in 2001 and 2000: already expired, so never cached.
    const expiry = extractExpiryTimestamp({ expires })
    assert.ok(Number.isFinite(expiry) && expiry < now, `Expires: ${JSON.stringify(expires)} produced ${expiry}`)
  }
  assert.ok(extractExpiryTimestamp({ expires: 'Thu, 01 Jan 2099 00:00:00 GMT' }) > now + 7200)
  assert.equal(extractExpiryTimestamp({ expires: 'Thu, 01 Jan 2015 00:00:00 GMT' }), Date.UTC(2015, 0, 1) / 1000,
    'a past Expires date is kept so the image is not cached')
  assert.equal(extractExpiryTimestamp({ 'cache-control': 'max-age=60', age: '10' }), now + 50)
})

test('cleanup drops entries whose expiry is not a number', () => {
  const cache = new ImageCache()
  // add() refuses such entries now; seed one directly to exercise the sweep.
  cache._cache.set('https://example.com/a', { mimeType: 'image/png', data: Buffer.alloc(1), expiry: NaN })
  cache.add('https://example.com/b', 'image/png', Buffer.alloc(1), now + 1000)
  cache._cleanup()
  assert.equal(cache.has('https://example.com/a'), false)
  assert.equal(cache.has('https://example.com/b'), true)
})

test('already stale images are not added to the cache', () => {
  const cache = new ImageCache()
  cache.add('https://example.com/stale', 'image/png', Buffer.alloc(1), now - 1)
  cache.add('https://example.com/invalid', 'image/png', Buffer.alloc(1), NaN)
  assert.equal(cache.has('https://example.com/stale'), false)
  assert.equal(cache.has('https://example.com/invalid'), false)
})

test('evicts the least recently used images beyond the byte budget', () => {
  const cache = new ImageCache(10)
  cache.add('https://example.com/a', 'image/png', Buffer.alloc(4), now + 1000)
  cache.add('https://example.com/b', 'image/png', Buffer.alloc(4), now + 1000)
  // Reading an image makes it the most recently used one.
  cache.get('https://example.com/a')
  cache.add('https://example.com/c', 'image/png', Buffer.alloc(4), now + 1000)

  assert.equal(cache.has('https://example.com/a'), true)
  assert.equal(cache.has('https://example.com/b'), false)
  assert.equal(cache.has('https://example.com/c'), true)
  assert.equal(cache._bytes, 8)

  // Replacing an image counts only its new size.
  cache.add('https://example.com/c', 'image/png', Buffer.alloc(6), now + 1000)
  assert.equal(cache._bytes, 10)
  assert.equal(cache.has('https://example.com/a'), true)
})

test('does not cache images larger than the whole budget', () => {
  const cache = new ImageCache(10)
  cache.add('https://example.com/a', 'image/png', Buffer.alloc(4), now + 1000)
  cache.add('https://example.com/large', 'image/png', Buffer.alloc(11), now + 1000)

  assert.equal(cache.has('https://example.com/large'), false)
  assert.equal(cache.has('https://example.com/a'), true)
  assert.equal(cache._bytes, 4)
})

test('expired images are not served before the periodic cleanup', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: now * 1000 })
  const cache = new ImageCache(10)
  cache.add('https://example.com/a', 'image/png', Buffer.alloc(4), now + 60)
  assert.equal(cache.has('https://example.com/a'), true)

  t.mock.timers.tick(60_000)
  assert.equal(cache.has('https://example.com/a'), false)
  assert.equal(cache._bytes, 0)
})
