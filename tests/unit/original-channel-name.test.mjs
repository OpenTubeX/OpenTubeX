import assert from 'node:assert/strict'
import test from 'node:test'
import { createOriginalChannelNameResolver } from '../../src/renderer/helpers/api/original-channel-name.js'

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const feed = name => new Response(`<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Search translation</title><author><name>${name}</name></author>
</feed>`)

test('reads the original RSS author name without cookies or language overrides', async () => {
  const resolve = createOriginalChannelNameResolver(async (url, options) => {
    assert.equal(url, `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`)
    assert.equal(options.credentials, 'omit')
    assert.ok(options.signal instanceof AbortSignal)
    assert.ok(options.nativeTimeoutMs > 0)
    return feed('Original Channel &amp; friends — 原文')
  })
  assert.equal(await resolve(channelId), 'Original Channel & friends — 原文')
})

test('shares in-flight lookups and reuses successful names across channel cards', async () => {
  let calls = 0
  let release
  const resolve = createOriginalChannelNameResolver(() => {
    calls++
    return new Promise(done => { release = done })
  })
  const first = resolve(channelId)
  const second = resolve(channelId)
  assert.equal(calls, 1)
  release(feed('Original Channel'))
  assert.deepEqual(await Promise.all([first, second]), ['Original Channel', 'Original Channel'])
  assert.equal(await resolve(channelId), 'Original Channel')
  assert.equal(calls, 1)
})

for (const [failure, respond] of [
  ['HTTP failure', () => new Response('Blocked', { status: 429 })],
  ['network failure', () => { throw new Error('Offline') }],
  ['malformed feed', () => new Response('<html>Not a feed</html>')],
  ['blank name', () => feed('   ')]
]) {
  test(`allows fallback and a later retry after ${failure}`, async () => {
    let calls = 0
    const resolve = createOriginalChannelNameResolver(async () => ++calls === 1 ? respond() : feed('Original channel'))
    assert.equal(await resolve(channelId), null)
    assert.equal(await resolve(channelId), 'Original channel')
    assert.equal(calls, 2)
  })
}

test('does not request feeds for game categories or invalid channel IDs', async () => {
  const resolve = createOriginalChannelNameResolver(() => assert.fail('Unexpected feed request'))
  for (const id of ['game-category', 'UC123', '', `${channelId}&hl=fr`]) {
    assert.equal(await resolve(id), null)
  }
})

test('bounds the cache when browsing many different channels', async () => {
  let calls = 0
  const resolve = createOriginalChannelNameResolver(async () => { calls++; return feed('Original channel') })
  await resolve(channelId)
  for (let index = 0; index < 500; index++) {
    await resolve(`UC${String(index).padStart(22, '0')}`)
  }
  await resolve(channelId)
  assert.equal(calls, 502)
})
