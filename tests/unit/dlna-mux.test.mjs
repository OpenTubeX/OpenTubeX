import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createMuxedMediaServer } from '../../src/main/dlnaMux.js'

const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg'
const available = spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const close = server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) }

test('streams a playable H.264/AAC merge before the source downloads finish', { skip: !available }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'otx-dlna-mux-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30', '-t', '20',
    '-c:v', 'libx264', '-g', '30', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', join(directory, 'video.mp4')])
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '20',
    '-c:a', 'aac', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', join(directory, 'audio.m4a')])
  const [video, audio] = await Promise.all([readFile(join(directory, 'video.mp4')), readFile(join(directory, 'audio.m4a'))])
  let downloadsFinished = 0
  const timers = new Set()
  const upstream = createServer((request, response) => {
    const bytes = request.url === '/video' ? video : audio
    response.writeHead(200, { 'content-length': bytes.length })
    response.write(bytes.subarray(0, Math.floor(bytes.length / 2)))
    const timer = setTimeout(() => { downloadsFinished++; response.end(bytes.subarray(Math.floor(bytes.length / 2))) }, 5000)
    timers.add(timer)
    response.on('close', () => { clearTimeout(timer); timers.delete(timer) })
  })
  await listen(upstream)
  t.after(() => { for (const timer of timers) clearTimeout(timer); return close(upstream) })
  const base = `http://127.0.0.1:${upstream.address().port}`
  const relay = await createMuxedMediaServer(`${base}/video`, `${base}/audio`, '127.0.0.1', 'secret', { ffmpegPath: ffmpeg })
  await listen(relay)
  t.after(() => close(relay))
  const url = `http://127.0.0.1:${relay.address().port}/secret/video.mp4`
  assert.equal((await fetch(url.replace('secret', 'wrong'))).status, 404)
  assert.equal((await fetch(url, { headers: { Range: 'bytes=100-' } })).status, 416)
  const head = await fetch(url, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('accept-ranges'), 'none')
  assert.equal(head.headers.get('content-length'), null)
  const response = await fetch(url)
  assert.equal(response.status, 200)
  assert.equal(downloadsFinished, 0, 'Playback starts before either complete source is available')
  const merged = Buffer.from(await response.arrayBuffer())
  assert.match(merged.subarray(0, 32).toString('ascii'), /ftyp/)
  await writeFile(join(directory, 'merged.mp4'), merged)
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', join(directory, 'merged.mp4')]))
  assert.deepEqual(probe.streams.map(stream => stream.codec_name).sort(), ['aac', 'h264'])
  assert.equal(probe.streams.find(stream => stream.codec_name === 'h264').height, 90)
  execFileSync(ffmpeg, ['-v', 'error', '-i', join(directory, 'merged.mp4'), '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'])
})

test('a missing mux executable produces an HTTP error and can be stopped', async t => {
  const relay = await createMuxedMediaServer('https://media.test/video', 'https://media.test/audio', '127.0.0.1', 'secret', { ffmpegPath: '/nonexistent/otx-ffmpeg' })
  await listen(relay)
  t.after(() => close(relay))
  assert.equal(relay.muxFailed, false)
  const response = await fetch(`http://127.0.0.1:${relay.address().port}/secret/video.mp4`)
  assert.equal(response.status, 502)
  assert.equal(relay.muxFailed, true)
})
