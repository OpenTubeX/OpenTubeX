import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { promisify } from 'node:util'
import { ChromecastManager } from '../../src/main/chromecast.js'

const execFileAsync = promisify(execFile)
const deviceName = process.env.OPENTUBEX_CAST_TEST_DEVICE

// Run against openchromecast with its mpv backend. An explicitly selected
// device prevents this test from taking over another receiver on the LAN.
test('Cast emulator fetches MP4, local DASH and HLS and supports session controls', { skip: !deviceName, timeout: 90_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'otx-cast-media-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const demo = path.resolve('e2e/fixtures/media/demo.webm')
  await execFileAsync('ffmpeg', ['-v', 'error', '-i', demo, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-movflags', '+faststart', path.join(directory, 'video.mp4')])
  for (const [format, arguments_, filename] of [
    ['dash', ['-seg_duration', '3'], 'manifest.mpd'],
    ['hls', ['-hls_time', '3', '-hls_list_size', '0'], 'manifest.m3u8']
  ]) {
    await execFileAsync('ffmpeg', ['-v', 'error', '-i', path.join(directory, 'video.mp4'), '-c', 'copy', '-f', format, ...arguments_, path.join(directory, filename)])
  }
  const requests = []
  const upstream = createServer(async (request, response) => {
    try {
      const filename = new URL(request.url, 'http://localhost').pathname.slice(1)
      assert.ok(!filename.includes('/') && !filename.includes('..'))
      const data = filename === 'caption.vtt' ? Buffer.from('WEBVTT\n\n00:00.000 --> 00:10.000\nCast subtitle test\n') : await readFile(path.join(directory, filename))
      requests.push({ filename, range: request.headers.range })
      const type = filename.endsWith('.mpd') ? 'application/dash+xml' : filename.endsWith('.m3u8') ? 'application/x-mpegurl' : filename.endsWith('.vtt') ? 'text/vtt' : 'video/mp4'
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '')
      const start = match ? Number(match[1]) : 0
      const end = match && match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1
      response.writeHead(match ? 206 : 200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': end - start + 1,
        ...(match ? { 'content-range': `bytes ${start}-${end}/${data.length}` } : {}) })
      response.end(request.method === 'HEAD' ? undefined : data.subarray(start, end + 1))
    } catch { response.writeHead(404).end() }
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  t.after(() => { upstream.closeAllConnections(); upstream.close() })
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`
  const manager = new ChromecastManager(path.resolve('dist-e2e/opentubex-cast'))
  t.after(() => manager.stop())
  const device = (await manager.discover()).find(device => device.name === deviceName)
  assert.ok(device, `Cast test device ${deviceName} must be discoverable`)

  async function eventually(castId, predicate) {
    let state
    for (let attempt = 0; attempt < 60; attempt++) {
      state = await manager.status(1, castId)
      if (predicate(state)) return state
      await setTimeout(200)
    }
    assert.fail(`Cast emulator did not reach expected playback state: ${JSON.stringify(state)}`)
  }

  const dash = (await readFile(path.join(directory, 'manifest.mpd'), 'utf8')).replace(/(<MPD[^>]*>)/, `$1<BaseURL>${upstreamUrl}/</BaseURL>`)
  for (const source of [
    { url: `${upstreamUrl}/video.mp4`, contentType: 'video/mp4' },
    { url: `data:application/dash+xml;charset=UTF-8,${encodeURIComponent(dash)}`, contentType: 'application/dash+xml' },
    { url: `${upstreamUrl}/manifest.m3u8`, contentType: 'application/x-mpegurl' }
  ]) {
    const requestCount = requests.length
    const result = await manager.start(1, { deviceId: device.id, source, title: 'OpenTubeX Cast integration test', startSeconds: 1, paused: false,
      captions: [{ url: `${upstreamUrl}/caption.vtt`, label: 'English', language: 'en' }], captionIndex: null }, () => ({}), url => url.origin === upstreamUrl)
    assert.ok(result.castId, JSON.stringify(result))
    const id = result.castId
    await eventually(id, state => state.connected && !state.paused && state.duration >= 29 && state.currentTime >= 1 && state.currentTime <= 4 &&
      requests.slice(requestCount).some(request => source.contentType === 'video/mp4'
        ? request.filename === 'video.mp4'
        : source.contentType === 'application/dash+xml' ? request.filename.startsWith('chunk-') : request.filename.endsWith('.ts')))
    assert.equal((await manager.control(1, id, 'pause')).error, undefined)
    await eventually(id, state => state.paused)
    // openchromecast's mpv status cache can report PLAYING after seeking
    // even when mpv is paused. Verify pause/resume before seeking here;
    // the bridge unit test verifies Cast's PLAYBACK_PAUSE flag separately.
    assert.equal((await manager.control(1, id, 'play')).error, undefined)
    await eventually(id, state => !state.paused)
    assert.equal((await manager.control(1, id, 'seek', 15)).error, undefined)
    await eventually(id, state => !state.paused && state.currentTime >= 14.5 && state.currentTime <= 16)
    assert.ok(Math.abs((await manager.control(1, id, 'volume', 0.4)).volume - 0.4) < 0.0001)
    assert.equal((await manager.control(1, id, 'mute', true)).muted, true)
    const stopped = await manager.stop(1, id)
    assert.equal(stopped.connected, false)
    assert.ok(stopped.currentTime >= 15)
    console.log(`Verified ${source.contentType}: fetch, playback, pause, seek, volume, mute, resume, stop`)
  }
  assert.ok(requests.some(request => request.filename === 'video.mp4' && request.range))
  assert.ok(requests.some(request => request.filename.startsWith('chunk-')))
  assert.ok(requests.some(request => request.filename.endsWith('.ts')))
})
