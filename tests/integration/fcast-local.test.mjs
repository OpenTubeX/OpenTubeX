import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { promisify } from 'node:util'
import { FcastManager } from '../../src/main/fcast.js'

const execFileAsync = promisify(execFile)
const deviceName = process.env.OPENTUBEX_FCAST_TEST_DEVICE

// Explicit selection prevents taking over another receiver on the LAN.
test('FCast receiver plays MP4, DASH and HLS through the relay', { skip: !deviceName, timeout: 180_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'otx-fcast-media-'))
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
      const data = await readFile(path.join(directory, filename))
      requests.push(filename)
      const type = filename.endsWith('.mpd') ? 'application/dash+xml' : filename.endsWith('.m3u8') ? 'application/x-mpegurl' : filename.endsWith('.ts') ? 'video/mp2t' : 'video/mp4'
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
  const manager = new FcastManager(path.resolve('dist-e2e/opentubex-cast'))
  t.after(() => manager.stop())
  const device = (await manager.discover()).find(device => device.name === deviceName)
  assert.ok(device, `FCast test receiver ${deviceName} must be discoverable`)

  async function eventually(castId, predicate) {
    let state
    for (let attempt = 0; attempt < 75; attempt++) {
      state = manager.status(1, castId)
      if (predicate(state)) return state
      await setTimeout(200)
    }
    assert.fail(`FCast receiver did not reach the expected playback state: ${JSON.stringify(state)}`)
  }

  const dash = (await readFile(path.join(directory, 'manifest.mpd'), 'utf8')).replace(/(<MPD[^>]*>)/, `$1<BaseURL>${upstreamUrl}/</BaseURL>`)
  for (const source of [
    { url: `${upstreamUrl}/video.mp4`, contentType: 'video/mp4' },
    { url: `data:application/dash+xml;charset=UTF-8,${encodeURIComponent(dash)}`, contentType: 'application/dash+xml' },
    { url: `${upstreamUrl}/manifest.m3u8`, contentType: 'application/x-mpegurl' }
  ]) {
    const requestCount = requests.length
    const result = await manager.start(1, { deviceId: device.id, source, title: 'OpenTubeX FCast integration test', startSeconds: 1, paused: false, playbackRate: 1 },
      () => ({}), async url => url.origin === upstreamUrl ? [{ address: '127.0.0.1', family: 4 }] : null, fetch)
    assert.ok(result.castId, JSON.stringify(result))
    const id = result.castId
    await eventually(id, state => state.connected && !state.paused && state.duration >= 29 && state.currentTime >= 1 && state.currentTime <= 6)
    assert.ok(requests.slice(requestCount).some(filename => source.contentType === 'video/mp4'
      ? filename === 'video.mp4'
      : source.contentType === 'application/dash+xml' ? filename.startsWith('chunk-') : filename.endsWith('.ts')))
    assert.equal((await manager.control(1, id, 'pause')).error, undefined)
    await eventually(id, state => state.paused)
    assert.equal((await manager.control(1, id, 'play')).error, undefined)
    await eventually(id, state => !state.paused)
    assert.equal((await manager.control(1, id, 'seek', 15)).error, undefined)
    await eventually(id, state => !state.paused && state.currentTime >= 14.5 && state.currentTime <= 18)
    assert.ok(Math.abs((await manager.control(1, id, 'volume', 0.4)).volume - 0.4) < 0.0001)
    assert.equal((await manager.control(1, id, 'mute', true)).muted, true)
    assert.equal((await manager.control(1, id, 'mute', false)).volume, 0.4)
    const stopped = await manager.stop(1, id)
    assert.equal(stopped.connected, false)
    assert.ok(stopped.currentTime >= 15)
    console.log(`Verified ${source.contentType}: fetch, playback, pause, resume, seek, volume, mute, stop`)
  }

  // Natural completion is reported separately from a stop.
  const ending = await manager.start(1, { deviceId: device.id, source: { url: `${upstreamUrl}/video.mp4`, contentType: 'video/mp4' }, title: 'OpenTubeX FCast completion test', startSeconds: 25, paused: false, playbackRate: 1 },
    () => ({}), async url => url.origin === upstreamUrl ? [{ address: '127.0.0.1', family: 4 }] : null, fetch)
  assert.ok(ending.castId, JSON.stringify(ending))
  await eventually(ending.castId, state => state.connected && state.ended)
  await manager.stop(1, ending.castId)
  console.log('Verified natural completion')
})
