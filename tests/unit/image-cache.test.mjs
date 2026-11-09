import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { createImageCacheHandler, extractExpiryTimestamp, ImageCache } from '../../src/main/ImageCache.js'

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

test('expired images are not served before the periodic cleanup', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: now * 1000 })
  const cache = new ImageCache(10)
  cache.add('https://example.com/a', 'image/png', Buffer.alloc(4), now + 60)
  assert.equal(cache.has('https://example.com/a'), true)

  t.mock.timers.tick(60_000)
  assert.equal(cache.has('https://example.com/a'), false)
  assert.equal(cache._bytes, 0)
})

test('Cache-Control no-store and no-cache images are not reused', () => {
  const cache = new ImageCache()
  for (const cacheControl of ['no-store', 'no-cache', 'public, no-cache, max-age=3600', 'max-age=3600, No-Store', 'no-cache="set-cookie"']) {
    const url = `https://example.com/${encodeURIComponent(cacheControl)}`
    cache.add(url, 'image/png', Buffer.alloc(1), extractExpiryTimestamp({ 'cache-control': cacheControl }))
    assert.equal(cache.has(url), false, `Cache-Control: ${cacheControl} was cached`)
  }
  assert.ok(extractExpiryTimestamp({ 'cache-control': 'public' }) > now)
})

/**
 * A stand-in for Electron's net.request that answers each request with the
 * body for its Authorization header.
 * @param {Record<string, string>} bodies
 */
function fakeRequest(bodies) {
  const requests = []
  const request = ({ url, headers }) => {
    requests.push({ url, headers })
    const clientRequest = new EventEmitter()
    clientRequest.setHeader = () => {}
    clientRequest.end = () => {
      const response = new EventEmitter()
      response.statusCode = 200
      response.headers = { 'content-type': 'image/png', 'cache-control': 'max-age=3600' }
      clientRequest.emit('response', response)
      response.emit('data', Buffer.from(bodies[headers?.Authorization ?? '']))
      response.emit('end')
    }
    return clientRequest
  }
  return { request, requests }
}

test('images fetched with account credentials are not shared through the cache', async () => {
  const { request, requests } = fakeRequest({ '': 'public', 'Bearer a': 'account a', 'Bearer b': 'account b' })
  const authorizations = new Map([[1, 'Bearer a'], [2, 'Bearer b']])
  const handle = createImageCacheHandler(new ImageCache(), (_url, id) => {
    const authorization = authorizations.get(id)
    return authorization ? { Authorization: authorization } : undefined
  }, request)
  const imageUrl = `imagecache://${encodeURIComponent('https://invidious.example.com/vi/a/default.jpg')}`
  const load = async (suffix) => (await handle(new Request(imageUrl + suffix))).text()

  assert.equal(await load('#1'), 'account a')
  assert.equal(await load('#2'), 'account b')
  assert.equal(await load('#3'), 'public', 'an unauthenticated window got an account image')
  assert.equal(await load(''), 'public')
  assert.equal(await load('#1'), 'account a')
  // Only the unauthenticated image comes from the cache.
  assert.equal(requests.length, 4)
})
