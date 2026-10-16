import assert from 'node:assert/strict'
import test from 'node:test'

import { extractExpiryTimestamp, ImageCache } from '../../src/main/ImageCache.js'

const now = Math.trunc(Date.now() / 1000)

test('an unparsable Expires header falls back to the default lifetime instead of never expiring', () => {
  for (const expires of ['-1', '0', 'never', '']) {
    const expiry = extractExpiryTimestamp({ expires })
    assert.ok(Number.isFinite(expiry), `Expires: ${JSON.stringify(expires)} produced ${expiry}`)
    assert.ok(expiry > now && expiry <= now + 7200 + 1)
  }
  assert.ok(extractExpiryTimestamp({ expires: 'Thu, 01 Jan 2099 00:00:00 GMT' }) > now + 7200)
  assert.equal(extractExpiryTimestamp({ 'cache-control': 'max-age=60', age: '10' }), now + 50)
})

test('cleanup drops entries whose expiry is not a number', () => {
  const cache = new ImageCache()
  cache.add('https://example.com/a', 'image/png', Buffer.alloc(1), NaN)
  cache.add('https://example.com/b', 'image/png', Buffer.alloc(1), now + 1000)
  cache._cleanup()
  assert.equal(cache.has('https://example.com/a'), false)
  assert.equal(cache.has('https://example.com/b'), true)
})
