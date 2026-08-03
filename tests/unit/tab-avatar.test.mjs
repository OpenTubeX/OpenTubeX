import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchTabAvatarBytes } from '../../src/renderer/helpers/tabAvatar.js'

test('rejects non-web avatar URLs before fetching', async () => {
  let fetched = false
  globalThis.fetch = async () => {
    fetched = true
    throw new Error('unexpected fetch')
  }

  assert.equal(await fetchTabAvatarBytes('file:///etc/passwd'), null)
  assert.equal(await fetchTabAvatarBytes('not a URL'), null)
  assert.equal(fetched, false)
})

test('returns bytes from a valid image response', async () => {
  globalThis.fetch = async () => new Response(Uint8Array.from([1, 2, 3]), {
    headers: { 'content-type': 'image/png' }
  })

  const bytes = await fetchTabAvatarBytes('https://example.com/avatar.png')

  assert.deepEqual(new Uint8Array(bytes), Uint8Array.from([1, 2, 3]))
})

test('rejects non-images and oversized responses', async () => {
  globalThis.fetch = async () => new Response('not an image', {
    headers: { 'content-type': 'text/plain' }
  })
  assert.equal(await fetchTabAvatarBytes('https://example.com/avatar'), null)

  globalThis.fetch = async () => new Response(null, {
    headers: {
      'content-length': String(2 * 1024 * 1024 + 1),
      'content-type': 'image/jpeg'
    }
  })
  assert.equal(await fetchTabAvatarBytes('https://example.com/avatar.jpg'), null)
})
