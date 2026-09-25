import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { registerDownloadedMediaProtocol } from '../../src/main/downloadMediaProtocol.js'

test('downloadmedia serves full and byte-range requests with matching headers', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-downloadmedia-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filename = path.join(directory, 'video.webm')
  await writeFile(filename, '0123456789')
  let handler
  registerDownloadedMediaProtocol({
    protocol: { handle: (scheme, callback) => { assert.equal(scheme, 'downloadmedia'); handler = callback } },
    getDownloadFile: async (id, videoId) => {
      assert.equal(id, 7)
      assert.equal(videoId, 'abcdefghijk')
      return { path: filename, mode: 'video' }
    }
  })

  const url = 'downloadmedia://file/7/abcdefghijk'
  const full = await handler(new Request(url))
  assert.equal(full.status, 200)
  assert.equal(full.headers.get('content-length'), '10')
  assert.equal(await full.text(), '0123456789')

  const partial = await handler(new Request(url, { headers: { range: 'bytes=2-5' } }))
  assert.equal(partial.status, 206)
  assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10')
  assert.equal(await partial.text(), '2345')

  const head = await handler(new Request(url, { method: 'HEAD' }))
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-length'), '10')
  assert.equal(await head.text(), '')
})

test('downloadmedia rejects unsafe paths, missing files, and unsatisfiable ranges', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-downloadmedia-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filename = path.join(directory, 'audio.webm')
  await writeFile(filename, '1234')
  let handler
  registerDownloadedMediaProtocol({
    protocol: { handle: (_, callback) => { handler = callback } },
    getDownloadFile: async () => ({ path: filename, mode: 'audio' })
  })
  const url = 'downloadmedia://file/7/abcdefghijk'
  assert.equal((await handler(new Request(url, { method: 'POST' }))).status, 405)
  assert.equal((await handler(new Request('downloadmedia://file/invalid/abcdefghijk'))).status, 400)
  assert.equal((await handler(new Request(url, { headers: { range: 'bytes=10-' } }))).status, 416)
  assert.equal((await handler(new Request(url))).headers.get('content-type'), 'audio/webm')
})
