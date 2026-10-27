import assert from 'node:assert/strict'
import test from 'node:test'

import {
  avoidUnreachableGoogleVideoHost,
  fetchGoogleVideo,
  getGoogleVideoFallbackUrl,
  markGoogleVideoHostUnreachable,
  setAlwaysUseGoogleVideoBackupServer
} from '../../src/renderer/helpers/player/googleVideoFallback.js'

const streamUrl = host => `https://${host}.googlevideo.com/videoplayback?expire=1&mn=sn-dead-1%2Csn-backup-2&fvip=4&itag=251`

test('the backup server comes from the mn and fvip parameters', () => {
  const fallbackUrl = new URL(getGoogleVideoFallbackUrl(streamUrl('rr10---sn-dead-1')))
  assert.equal(fallbackUrl.hostname, 'rr4---sn-backup-2.googlevideo.com')
  assert.equal(fallbackUrl.searchParams.get('itag'), '251')
  assert.equal(getGoogleVideoFallbackUrl(streamUrl('rr4---sn-backup-2')), null)
  assert.equal(getGoogleVideoFallbackUrl('https://rr1---sn-a.googlevideo.com/videoplayback?itag=251'), null)
  assert.equal(getGoogleVideoFallbackUrl('https://example.com/videoplayback?mn=sn-a,sn-b&fvip=1'), null)
})

test('HLS segment URLs carry the backup server in their path', () => {
  const url = 'https://rr3---sn-dead-1.googlevideo.com/videoplayback/id/1/mn/sn-dead-1,sn-backup-2/fvip/3/playlist/index.m3u8/begin/0/file/seg.ts'
  assert.equal(getGoogleVideoFallbackUrl(url),
    'https://rr3---sn-backup-2.googlevideo.com/videoplayback/id/1/mn/sn-dead-1,sn-backup-2/fvip/3/playlist/index.m3u8/begin/0/file/seg.ts')
})

test('later requests skip a node that did not respond', () => {
  const url = streamUrl('rr5---sn-dead-1')
  assert.equal(avoidUnreachableGoogleVideoHost(url), url)
  markGoogleVideoHostUnreachable(url)
  assert.equal(new URL(avoidUnreachableGoogleVideoHost(url)).hostname, 'rr4---sn-backup-2.googlevideo.com')
  assert.equal(avoidUnreachableGoogleVideoHost(streamUrl('rr6---sn-dead-1')), streamUrl('rr6---sn-dead-1'))
})

test('a connection that fails switches to the backup server', async () => {
  const requested = []
  const response = await fetchGoogleVideo(streamUrl('rr7---sn-dead-1'), { method: 'POST' }, async (url, init) => {
    requested.push(new URL(url).hostname)
    if (requested.length === 1) throw new TypeError('Failed to fetch')
    assert.equal(init.method, 'POST')
    return new Response('ok')
  })
  assert.equal(await response.text(), 'ok')
  assert.deepEqual(requested, ['rr7---sn-dead-1.googlevideo.com', 'rr4---sn-backup-2.googlevideo.com'])
})

test('a node without a response in time switches to the backup server', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const requested = []
  const pending = fetchGoogleVideo(streamUrl('rr8---sn-dead-1'), {}, (url, init) => {
    requested.push(new URL(url).hostname)
    if (requested.length > 1) return Promise.resolve(new Response('ok'))
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
  })
  t.mock.timers.tick(5_000)
  assert.equal(await (await pending).text(), 'ok')
  assert.deepEqual(requested, ['rr8---sn-dead-1.googlevideo.com', 'rr4---sn-backup-2.googlevideo.com'])
})

test('a request the caller aborts stays on its node', async () => {
  const controller = new AbortController()
  let requests = 0
  const pending = fetchGoogleVideo(streamUrl('rr9---sn-dead-1'), { signal: controller.signal }, (_url, init) => {
    requests++
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
  })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(requests, 1)
  assert.equal(avoidUnreachableGoogleVideoHost(streamUrl('rr9---sn-dead-1')), streamUrl('rr9---sn-dead-1'))
})

test('a 502 from the native proxy switches to the backup server', async () => {
  const requested = []
  const response = await fetchGoogleVideo(streamUrl('rr11---sn-dead-1'), {}, async url => {
    requested.push(new URL(url).hostname)
    return new Response(requested.length === 1 ? null : 'ok', { status: requested.length === 1 ? 502 : 200 })
  })
  assert.equal(await response.text(), 'ok')
  assert.deepEqual(requested, ['rr11---sn-dead-1.googlevideo.com', 'rr4---sn-backup-2.googlevideo.com'])
})

test('a malformed escape in an HLS path keeps the original server', () => {
  assert.equal(getGoogleVideoFallbackUrl('https://rr3---sn-a.googlevideo.com/videoplayback/mn/%E0%A4%A/fvip/3'), null)
})

test('HLS paths may encode the comma between servers in lowercase', () => {
  assert.equal(new URL(getGoogleVideoFallbackUrl('https://rr3---sn-a.googlevideo.com/videoplayback/mn/sn-a%2csn-b/fvip/3')).hostname,
    'rr3---sn-b.googlevideo.com')
})

test('the backup server can be used for every request', async t => {
  setAlwaysUseGoogleVideoBackupServer(true)
  t.after(() => setAlwaysUseGoogleVideoBackupServer(false))

  assert.equal(new URL(avoidUnreachableGoogleVideoHost(streamUrl('rr12---sn-slow-1'))).hostname, 'rr4---sn-backup-2.googlevideo.com')
  const withoutBackup = 'https://rr1---sn-a.googlevideo.com/videoplayback?itag=251'
  assert.equal(avoidUnreachableGoogleVideoHost(withoutBackup), withoutBackup)

  const requested = []
  const response = await fetchGoogleVideo(streamUrl('rr12---sn-slow-1'), {}, async (url, init) => {
    requested.push(new URL(url).hostname)
    assert.equal(init.signal, undefined)
    return new Response('ok')
  })
  assert.equal(await response.text(), 'ok')
  assert.deepEqual(requested, ['rr4---sn-backup-2.googlevideo.com'])
})
