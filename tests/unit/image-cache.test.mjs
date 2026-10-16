import assert from 'node:assert/strict'
import test from 'node:test'

import { extractExpiryTimestamp, ImageCache } from '../../src/main/ImageCache.js'

const now = Math.trunc(Date.now() / 1000)

test('an unparsable Expires header falls back to the default lifetime instead of never expiring', () => {
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
