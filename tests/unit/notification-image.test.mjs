import assert from 'node:assert/strict'
import test from 'node:test'
import { importWithElectron } from '../helpers/main-process.mjs'

let respond = null
const [{ loadNotificationImage, setNotificationImagesAllowed }] = await importWithElectron([
  new URL('../../src/main/notificationImage.js', import.meta.url).href,
], {
  net: { fetch: (...args) => respond(...args) },
  nativeImage: { createFromBuffer: buffer => ({ isEmpty: () => buffer.length === 0, size: buffer.length }) }
})

test('notification images stop reading a body without a length once it exceeds the limit', async () => {
  let pulled = 0
  respond = async () => new Response(new ReadableStream({
    pull(controller) {
      pulled += 1024 * 1024
      controller.enqueue(new Uint8Array(1024 * 1024))
    }
  }))
  assert.equal(await loadNotificationImage('https://i.ytimg.com/vi/abc/mqdefault.jpg'), undefined)
  assert.ok(pulled <= 7 * 1024 * 1024, `read ${pulled} bytes`)
})

test('notification images stay off while the thumbnail settings hide or blur thumbnails', async () => {
  let fetched = 0
  respond = async () => { fetched++; return new Response(new Uint8Array([1, 2, 3])) }
  let allowed = false
  setNotificationImagesAllowed(() => allowed)
  assert.equal(await loadNotificationImage('https://i.ytimg.com/vi/abc/mqdefault.jpg'), undefined)
  assert.equal(fetched, 0)

  allowed = true
  assert.equal((await loadNotificationImage('https://i.ytimg.com/vi/abc/mqdefault.jpg')).size, 3)
})

test('notification images give up on a body that stalls past the timeout', async () => {
  setNotificationImagesAllowed(() => true)
  respond = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])) },
    pull() { return new Promise(() => {}) }
  }))
  const start = Date.now()
  assert.equal(await loadNotificationImage('https://i.ytimg.com/vi/abc/mqdefault.jpg'), undefined)
  assert.ok(Date.now() - start < 5000)
})
