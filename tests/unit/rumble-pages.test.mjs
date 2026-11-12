import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchRumblePage } from '../../src/main/rumblePages.js'

test('loads only Rumble pages over HTTPS', async () => {
  const requested = []
  const fetch = async (url) => {
    requested.push(url)
    return new Response('<html></html>', { status: 404 })
  }

  assert.deepEqual(await fetchRumblePage(fetch, 'https://rumble.com/c/Example?page=2'), { status: 404, text: '<html></html>' })
  for (const url of [
    'http://rumble.com/c/Example',
    'https://rumble.com.example.test/c/Example',
    'https://notrumble.com/c/Example',
    'https://user@rumble.com/c/Example',
    'https://rumble.com:8443/c/Example',
    'file:///etc/passwd',
    'not a url',
    42
  ]) {
    await assert.rejects(fetchRumblePage(fetch, url), /Not a Rumble page/, String(url))
  }
  assert.deepEqual(requested, ['https://rumble.com/c/Example?page=2'])
})

test('rejects oversized Rumble pages', async () => {
  const fetch = async () => new Response('x', { headers: { 'Content-Length': '20000000' } })
  await assert.rejects(fetchRumblePage(fetch, 'https://rumble.com/'), /too large/)
})
