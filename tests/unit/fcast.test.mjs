import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { FcastManager, FcastOpcode, createFcastPacketReader, encodeFcastPacket } from '../../src/main/fcast.js'

test('FCast packets use a little-endian size, an opcode and a JSON body', () => {
  const packet = encodeFcastPacket(FcastOpcode.SEEK, { time: 12.5 })
  assert.equal(packet.readUInt32LE(0), packet.length - 4)
  assert.equal(packet[4], FcastOpcode.SEEK)
  assert.equal(packet.subarray(5).toString(), '{"time":12.5}')
  assert.deepEqual([...encodeFcastPacket(FcastOpcode.PAUSE)], [1, 0, 0, 0, FcastOpcode.PAUSE])
  assert.throws(() => encodeFcastPacket(FcastOpcode.PLAY, { url: 'x'.repeat(32_000) }), { code: 'CAST_INVALID_REQUEST' })

  const packets = []
  const read = createFcastPacketReader((opcode, body) => packets.push({ opcode, body }))
  const stream = Buffer.concat([packet, encodeFcastPacket(FcastOpcode.PING), encodeFcastPacket(FcastOpcode.VERSION, { version: 3 })])
  for (let offset = 0; offset < stream.length; offset += 3) read(stream.subarray(offset, offset + 3))
  assert.deepEqual(packets, [
    { opcode: FcastOpcode.SEEK, body: { time: 12.5 } },
    { opcode: FcastOpcode.PING, body: undefined },
    { opcode: FcastOpcode.VERSION, body: { version: 3 } }
  ])
  assert.throws(() => createFcastPacketReader(() => {})(Buffer.from([0, 0, 0, 0, 1])), /Invalid FCast packet size/)
  assert.throws(() => createFcastPacketReader(() => {})(Buffer.from([0, 0, 0x10, 0])), /Invalid FCast packet size/)
})

/** A receiver on the real socket boundary, recording every packet it gets. */
async function receiverForTest(t, { version = 3, onPlay } = {}) {
  const receiver = { packets: [], sockets: new Set() }
  receiver.send = (opcode, body) => { for (const socket of receiver.sockets) socket.write(encodeFcastPacket(opcode, body)) }
  receiver.received = opcode => receiver.packets.filter(packet => packet.opcode === opcode).map(packet => packet.body)
  receiver.next = (opcode, count = 1) => new Promise(resolve => {
    const check = () => receiver.received(opcode).length >= count ? resolve(receiver.received(opcode).at(count - 1)) : setImmediate(check)
    check()
  })
  const server = createServer(socket => {
    receiver.sockets.add(socket)
    socket.on('close', () => receiver.sockets.delete(socket))
    socket.on('error', () => {})
    if (version) socket.write(encodeFcastPacket(FcastOpcode.VERSION, { version }))
    socket.on('data', createFcastPacketReader(async (opcode, body) => {
      receiver.packets.push({ opcode, body })
      if (opcode === FcastOpcode.PLAY) await onPlay?.(body, receiver)
    }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    for (const socket of receiver.sockets) socket.destroy()
    server.close()
  })
  receiver.device = { id: 'Living Room', name: 'Living Room', address: '127.0.0.1', port: server.address().port }
  return receiver
}

async function upstreamForTest(t) {
  const requests = []
  const server = createHttpServer((request, response) => {
    requests.push(request.headers)
    response.writeHead(200, { 'content-type': 'video/mp4' }).end('video bytes')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  return { url: `http://127.0.0.1:${server.address().port}/video.mp4`, requests }
}

function managerForTest(t, receiver, options = {}) {
  const manager = new FcastManager('/must-not-run', options.powerSaveBlocker, { appVersion: '1.2.3', ...options })
  manager.devices.set(receiver.device.id, receiver.device)
  t.after(() => manager.stop())
  return manager
}

const allowLocal = async () => [{ address: '127.0.0.1', family: 4 }]
const payload = (url, overrides = {}) => ({
  deviceId: 'Living Room', title: 'Test video', startSeconds: 12, paused: false, playbackRate: 1.5,
  source: { url, contentType: 'video/mp4' }, ...overrides
})
const startPlayback = (body, receiver) => {
  receiver.send(FcastOpcode.PLAYBACK_UPDATE, { generationTime: Date.now(), state: 1, time: body.time ?? 0, duration: 120, speed: body.speed })
}
const play = async (body, receiver) => {
  const media = await fetch(body.url)
  receiver.media = { status: media.status, body: await media.text() }
  startPlayback(body, receiver)
}

test('FCast plays through the relay and controls the receiver until it stops', async t => {
  const receiver = await receiverForTest(t, { onPlay: play })
  const upstream = await upstreamForTest(t)
  const blockers = []
  const powerSaveBlocker = { start: () => { blockers.push('start'); return 1 }, stop: () => blockers.push('stop') }
  const manager = managerForTest(t, receiver, { powerSaveBlocker })
  const stages = []
  const result = await manager.start(7, payload(upstream.url), () => ({ Authorization: 'Bearer upstream' }), allowLocal,
    (url, options) => fetch(url, options), stage => stages.push(stage))
  assert.ok(result.castId, result.error)
  assert.equal(result.deviceName, 'Living Room')
  assert.deepEqual(stages, ['connecting', 'loading'])
  assert.deepEqual(result.status, { connected: true, currentTime: 12, duration: 120, paused: false, buffering: false, ended: false, volume: 1, muted: false, activeTrackIds: [] })
  assert.deepEqual(receiver.packets.slice(0, 3), [
    { opcode: FcastOpcode.VERSION, body: { version: 3 } },
    { opcode: FcastOpcode.INITIAL, body: { appName: 'OpenTubeX', appVersion: '1.2.3' } },
    { opcode: FcastOpcode.SUBSCRIBE_EVENT, body: { event: { type: 1 } } }
  ])
  const [played] = receiver.received(FcastOpcode.PLAY)
  assert.match(played.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{48}\/0\/media$/)
  assert.deepEqual({ ...played, url: undefined }, { container: 'video/mp4', url: undefined, time: 12, speed: 1.5, metadata: { type: 0, title: 'Test video' } })
  // The receiver gets the relayed bytes, never the upstream URL or its credentials.
  assert.deepEqual(receiver.media, { status: 200, body: 'video bytes' })
  assert.equal(upstream.requests[0].authorization, 'Bearer upstream')
  assert.deepEqual(blockers, ['start'])
  assert.deepEqual(manager.status(8, result.castId), { connected: false })

  assert.equal((await manager.control(7, result.castId, 'pause')).paused, true)
  assert.deepEqual(blockers, ['start', 'stop'])
  assert.equal((await manager.control(7, result.castId, 'play')).paused, false)
  assert.equal((await manager.control(7, result.castId, 'seek', 30)).currentTime, 30)
  assert.equal((await manager.control(7, result.castId, 'volume', 0.4)).volume, 0.4)
  assert.deepEqual(await manager.control(7, result.castId, 'mute', true).then(({ volume, muted }) => ({ volume, muted })), { volume: 0.4, muted: true })
  assert.deepEqual(await manager.control(7, result.castId, 'mute', false).then(({ volume, muted }) => ({ volume, muted })), { volume: 0.4, muted: false })
  assert.equal((await manager.control(7, result.castId, 'caption', 1)).errorCode, 'CAST_INVALID_REQUEST')
  await receiver.next(FcastOpcode.SET_VOLUME, 3)
  assert.deepEqual(receiver.packets.slice(4).map(({ opcode, body }) => [opcode, body]), [
    [FcastOpcode.PAUSE, undefined],
    [FcastOpcode.RESUME, undefined],
    [FcastOpcode.SEEK, { time: 30 }],
    [FcastOpcode.SET_VOLUME, { volume: 0.4 }],
    [FcastOpcode.SET_VOLUME, { volume: 0 }],
    [FcastOpcode.SET_VOLUME, { volume: 0.4 }]
  ])

  receiver.send(FcastOpcode.PING)
  await receiver.next(FcastOpcode.PONG)
  receiver.send(FcastOpcode.VOLUME_UPDATE, { generationTime: Date.now(), volume: 0.7 })
  receiver.send(FcastOpcode.PLAYBACK_UPDATE, { generationTime: Date.now(), state: 1, time: 45, duration: 120, speed: 1.5 })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(manager.status(7, result.castId), { connected: true, currentTime: 45, duration: 120, paused: false, buffering: false, ended: false, volume: 0.7, muted: false, activeTrackIds: [] })
  const stopped = await manager.stop(7, result.castId)
  assert.deepEqual({ connected: stopped.connected, currentTime: stopped.currentTime }, { connected: false, currentTime: 45 })
  await receiver.next(FcastOpcode.STOP)
  assert.equal(manager.active, null)
  assert.deepEqual(blockers, ['start', 'stop', 'start', 'stop'])
  assert.deepEqual(manager.status(7, result.castId), { connected: false })
})

test('FCast reports natural completion separately from a receiver stop', async t => {
  const receiver = await receiverForTest(t, { onPlay: play })
  const upstream = await upstreamForTest(t)
  const manager = managerForTest(t, receiver)
  let result = await manager.start(7, payload(upstream.url), () => ({}), allowLocal, fetch)
  receiver.send(FcastOpcode.EVENT, { generationTime: Date.now(), event: { type: 1, item: { container: 'video/mp4', url: receiver.received(FcastOpcode.PLAY)[0].url } } })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(manager.status(7, result.castId).ended, true)
  await manager.stop(7, result.castId)

  result = await manager.start(7, payload(upstream.url), () => ({}), allowLocal, fetch)
  receiver.send(FcastOpcode.PLAYBACK_UPDATE, { generationTime: Date.now(), state: 1, time: 40, duration: 120 })
  receiver.send(FcastOpcode.PLAYBACK_UPDATE, { generationTime: Date.now(), state: 0, time: 0, duration: 0 })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(manager.status(7, result.castId), { connected: false })
  assert.equal(manager.active, null)
  assert.equal(receiver.sockets.size, 0)
})

test('FCast stops its session when another sender replaces the video', async t => {
  const receiver = await receiverForTest(t, { onPlay: play })
  const upstream = await upstreamForTest(t)
  const manager = managerForTest(t, receiver)
  const result = await manager.start(7, payload(upstream.url), () => ({}), allowLocal, fetch)
  receiver.send(FcastOpcode.PLAY_UPDATE, { generationTime: Date.now(), playData: { container: 'video/mp4', url: receiver.received(FcastOpcode.PLAY)[0].url } })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(manager.status(7, result.castId).connected, true)
  receiver.send(FcastOpcode.PLAY_UPDATE, { generationTime: Date.now(), playData: { container: 'video/mp4', url: 'https://other.test/video.mp4' } })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(manager.status(7, result.castId).connected, false)
})

test('FCast reports receiver load failures and closes the relay', async t => {
  let mediaUrl
  const receiver = await receiverForTest(t, {
    onPlay: (body, receiver) => {
      mediaUrl = body.url
      receiver.send(FcastOpcode.PLAYBACK_ERROR, { message: 'Unsupported codec' })
    }
  })
  const manager = managerForTest(t, receiver)
  const result = await manager.start(7, payload('https://media.test/video.mp4'), () => ({}), allowLocal, fetch)
  assert.deepEqual(result, { error: 'Unsupported codec', errorCode: 'CAST_LOAD_FAILED' })
  await receiver.next(FcastOpcode.STOP)
  assert.equal(manager.active, null)
  await assert.rejects(fetch(mediaUrl))
})

test('FCast times out when the receiver never starts playback', async t => {
  const receiver = await receiverForTest(t)
  const manager = managerForTest(t, receiver, { loadTimeoutMs: 100 })
  const result = await manager.start(7, payload('https://media.test/video.mp4'), () => ({}), allowLocal, fetch)
  assert.deepEqual(result, { error: 'FCast receiver did not start playback', errorCode: 'CAST_TIMEOUT' })
  await receiver.next(FcastOpcode.STOP)
  assert.equal(manager.starting, false)
})

test('FCast reports an unreachable receiver as unresponsive', async t => {
  const receiver = await receiverForTest(t)
  const manager = managerForTest(t, receiver)
  manager.devices.set('Living Room', { ...receiver.device, port: 1 })
  assert.deepEqual(await manager.start(7, payload('https://media.test/video.mp4'), () => ({}), allowLocal, fetch),
    { error: 'FCast receiver did not respond', errorCode: 'CAST_TIMEOUT' })
})

test('FCast adapts the play message to version 2 receivers and HLS', async t => {
  const receiver = await receiverForTest(t, { version: 2, onPlay: startPlayback })
  const manager = managerForTest(t, receiver)
  const result = await manager.start(7, payload('https://media.test/live.m3u8', {
    source: { url: 'https://media.test/live.m3u8', contentType: 'application/x-mpegurl' }, isLive: true, paused: true
  }), () => ({}), allowLocal, fetch)
  assert.ok(result.castId, result.error)
  assert.equal(result.status.paused, true)
  await receiver.next(FcastOpcode.PAUSE)
  assert.deepEqual(receiver.packets.map(({ opcode }) => opcode), [FcastOpcode.VERSION, FcastOpcode.PLAY, FcastOpcode.PAUSE])
  const [played] = receiver.received(FcastOpcode.PLAY)
  assert.deepEqual(Object.keys(played), ['container', 'url', 'speed'])
  assert.equal(played.container, 'application/vnd.apple.mpegurl')
})

test('FCast keeps one session and validates media before connecting', async t => {
  const receiver = await receiverForTest(t, { onPlay: play })
  const upstream = await upstreamForTest(t)
  const manager = managerForTest(t, receiver)
  for (const invalid of [
    payload(upstream.url, { deviceId: 'Unknown' }),
    payload(upstream.url, { playbackRate: 0 }),
    payload(upstream.url, { source: { url: 'file:///etc/passwd', contentType: 'video/mp4' } }),
    payload(upstream.url, { title: 'x'.repeat(501) })
  ]) {
    assert.equal((await manager.start(7, invalid, () => ({}), allowLocal, fetch)).errorCode, 'CAST_INVALID_REQUEST')
  }
  assert.equal(receiver.packets.length, 0)
  const result = await manager.start(7, payload(upstream.url), () => ({}), allowLocal, fetch)
  assert.ok(result.castId, result.error)
  assert.equal((await manager.start(8, payload(upstream.url), () => ({}), allowLocal, fetch)).errorCode, 'CAST_BUSY')
  assert.equal((await manager.control(8, result.castId, 'pause')).errorCode, 'CAST_DISCONNECTED')
  assert.deepEqual(await manager.stop(8, result.castId), { connected: false })
  assert.equal(manager.status(7, result.castId).connected, true)
})

test('FCast discovers receivers through the packaged helper', async t => {
  if (process.platform === 'win32') { t.skip('POSIX helper fixture'); return }
  const directory = await mkdtemp(path.join(tmpdir(), 'otx-fcast-discovery-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const executable = path.join(directory, 'discover.sh')
  await writeFile(executable, `#!/bin/sh
[ "$1" = discover-fcast ] || exit 1
printf '%s\\n' '[{"id":"TV","name":"TV","address":"127.0.0.1","port":46899},{"id":"Kitchen","name":"Kitchen","address":"::1","port":46899}]'
`)
  await chmod(executable, 0o755)
  const manager = new FcastManager(executable)
  assert.deepEqual(await manager.discover(), [{ id: 'TV', name: 'TV' }])
  assert.equal(manager.devices.get('TV').port, 46899)
})

test('FCast waits for receiver progress, not the Android receiver buffering update', async t => {
  let progressSent = false
  const receiver = await receiverForTest(t, {
    onPlay: (body, receiver) => {
      receiver.send(FcastOpcode.PLAYBACK_UPDATE, { generationTime: Date.now(), state: 1, time: 0, duration: 0, speed: 1 })
      setTimeout(() => {
        progressSent = true
        receiver.send(FcastOpcode.PLAYBACK_UPDATE, { generationTime: Date.now(), state: 1, time: body.time, duration: 120, speed: 1 })
      }, 50)
    }
  })
  const upstream = await upstreamForTest(t)
  const manager = managerForTest(t, receiver)
  const result = await manager.start(7, payload(upstream.url), () => ({}), allowLocal, fetch)
  assert.ok(result.castId, result.error)
  assert.equal(progressSent, true, 'The buffering update must not complete startup')
  assert.deepEqual({ currentTime: result.status.currentTime, duration: result.status.duration }, { currentTime: 12, duration: 120 })
})

test('FCast reports a receiver playback error after startup', async t => {
  const receiver = await receiverForTest(t, { onPlay: play })
  const upstream = await upstreamForTest(t)
  const manager = managerForTest(t, receiver)
  const result = await manager.start(7, payload(upstream.url), () => ({}), allowLocal, fetch)
  receiver.send(FcastOpcode.PLAYBACK_ERROR, { message: 'Source error' })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(manager.status(7, result.castId), { connected: false, error: 'Source error', errorCode: 'CAST_LOAD_FAILED' })
  assert.deepEqual(manager.status(8, result.castId), { connected: false })
})
