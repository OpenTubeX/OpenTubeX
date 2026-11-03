import assert from 'node:assert/strict'
import test from 'node:test'
import { importWithElectron } from '../helpers/main-process.mjs'

let respond = null
const [{ loadNotificationImage }] = await importWithElectron([
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

test('notification images load small bodies', async () => {
  respond = async () => new Response(new Uint8Array([1, 2, 3]))
  assert.equal((await loadNotificationImage('https://i.ytimg.com/vi/abc/mqdefault.jpg')).size, 3)
})
