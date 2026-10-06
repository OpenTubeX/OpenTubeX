import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ChromecastManager } from '../../src/main/chromecast.js'
import { CAST_MEDIA, CastSender } from '../../src/main/castSender.js'
import { EventEmitter } from 'node:events'

test('macOS packaging declares every Bonjour service browsed by the Cast helper', async () => {
  const { default: config } = await import('../../_scripts/ebuilder.config.mjs')
  const helper = await readFile(new URL('../../_scripts/cast-sender/main.go', import.meta.url), 'utf8')
  const services = [...helper.matchAll(/resolver\.Browse\(ctx, "([^"]+)"/g)].map(match => match[1])
  assert.ok(services.length > 0, 'Must find the native discovery service')
  assert.match(config.mac.extendInfo.NSLocalNetworkUsageDescription, /\S/)
  for (const service of services) {
    assert.ok(config.mac.extendInfo.NSBonjourServices?.includes(service), `Missing macOS Bonjour declaration for ${service}`)
  }
})

for (const wait of [false, true]) {
  test(`a failed helper write rejects a ${wait ? 'waiting' : 'non-waiting'} send`, async t => {
    const sender = new EventEmitter()
    Object.setPrototypeOf(sender, CastSender.prototype)
    let killed = false
    Object.assign(sender, {
      nextId: 1, pending: new Map(), closed: false,
      lines: { close() {} },
      process: { stdin: { write(_, callback) { queueMicrotask(() => callback(new Error('Broken pipe'))) } }, kill() { killed = true } }
    })
    t.after(() => sender.close())
    const result = await Promise.race([
      sender.send('namespace', 'receiver', { type: 'CONNECT' }, wait).then(() => 'resolved', error => error.message),
      new Promise(resolve => setTimeout(() => resolve('unsettled'), 100))
    ])
    assert.equal(result, 'Cast device disconnected')
    assert.equal(killed, true)
    assert.equal(sender.pending.size, 0)
  })
}

// A receiver at the bridge boundary makes session tests independent of LAN
// discovery and hardware. Native networking is covered by the emulator test.
const receiver = `#!/usr/bin/env node
import { createInterface } from 'node:readline'
const output = value => process.stdout.write(JSON.stringify(value)+'\\n')
if (process.argv[2] === 'discover') {
 output([{id:'device',name:'Test TV',address:'127.0.0.1',port:8009}])
 process.exit(0)
}
output({event:'connected',address:'127.0.0.1'})
const receiverStatus = {applications:[{appId:'CC1AD845',transportId:'transport',sessionId:'session'}],volume:{level:0.5,muted:false}}
let media = null
const lines=createInterface({input:process.stdin})
lines.on('line', async line=>{
 const command=JSON.parse(line)
 const p=command.payload
 let response
 if(p.type==='CONNECT') return
 if(command.namespace.endsWith('.receiver')) {
  if(p.type==='SET_VOLUME') Object.assign(receiverStatus.volume,p.volume)
  response={type:'RECEIVER_STATUS',status:receiverStatus}
 } else {
  if(p.type==='LOAD') {
   if(p.media.metadata.title==='Reject media') { output({event:'message',namespace:command.namespace,payload:{requestId:command.id,type:'LOAD_FAILED'}});return }
   const fetched=await fetch(p.media.contentId)
   if(!fetched.ok) throw new Error('media endpoint failed')
   await fetched.text()
   media={mediaSessionId:7,currentTime:p.currentTime,playbackRate:p.playbackRate??1,playerState:p.autoplay?'PLAYING':'PAUSED',volume:{level:1,muted:false},activeTrackIds:p.activeTrackIds,media:{...p.media,tracks:undefined,duration:120}}
  }
  if(p.type==='PLAY') media.playerState='PLAYING'
  if(p.type==='PAUSE') media.playerState='PAUSED'
  if(p.type==='SEEK') {media.currentTime=p.currentTime;media.playerState=p.resumeState==='PLAYBACK_PAUSE'?'PAUSED':'PLAYING';if(p.currentTime>=119){media.playerState='IDLE';media.idleReason=p.currentTime===120?'FINISHED':'CANCELLED'}}
  if(p.type==='EDIT_TRACKS_INFO') media.activeTrackIds=p.activeTrackIds
  if(p.type==='STOP') media.playerState='IDLE'
  response={type:'MEDIA_STATUS',status:media?[media]:[]}
 }
 output({event:'message',namespace:command.namespace,payload:{...response,requestId:command.id}})
})
lines.on('close',()=>process.exit(0))
`

async function managerForTest(t, powerSaveBlocker) {
  if (process.platform === 'win32') { t.skip('POSIX bridge fixture'); return null }
  const directory = await mkdtemp(path.join(tmpdir(), 'otx-cast-'))
  const executable = path.join(directory, 'sender.mjs')
  await writeFile(executable, receiver)
  await chmod(executable, 0o755)
  const manager = new ChromecastManager(executable, powerSaveBlocker)
  t.after(async () => { await manager.stop(); await rm(directory, { recursive: true, force: true }) })
  assert.deepEqual(await manager.discover(), [{ id: 'device', name: 'Test TV' }])
  return manager
}

const payload = {
  deviceId: 'device', title: 'Test video', startSeconds: 12, paused: false, playbackRate: 1,
  source: { url: 'data:application/dash+xml,%3CMPD%2F%3E', contentType: 'application/dash+xml' },
  captions: [{ label: 'English', language: 'en', url: 'https://media.test/en.vtt' }], captionIndex: 0
}

test('Cast loads the selected playback speed for playing and paused handoffs', async t => {
  const manager = await managerForTest(t)
  if (!manager) return
  for (const paused of [false, true]) {
    for (const playbackRate of [0.5, 1, 1.5, 2]) {
      const result = await manager.start(42, { ...payload, playbackRate, paused })
      assert.ok(result.castId, result.error)
      assert.equal(manager.active.status.playbackRate, playbackRate)
      assert.equal(result.status.paused, paused)
      assert.equal(result.status.currentTime, payload.startSeconds)
      await manager.stop(42, result.castId)
    }
  }
})

test('Cast rejects invalid playback speeds before connecting to a receiver', async () => {
  const manager = new ChromecastManager('/must-not-run')
  manager.devices.set('device', { id: 'device', address: '127.0.0.1', port: 8009 })
  for (const playbackRate of [undefined, null, '1.5', 0, -1, NaN, Infinity]) {
    assert.match((await manager.start(42, { ...payload, playbackRate })).error, /Invalid Cast device or media/)
    assert.equal(manager.active, null)
    assert.equal(manager.starting, false)
  }
})

test('Cast accepts authenticated WebVTT without forwarding the original caption URL', async t => {
  const manager = await managerForTest(t)
  if (!manager) return
  const caption = { label: 'English', language: 'en', url: 'data:text/vtt;charset=utf-8,WEBVTT%0A%0APrivate%20caption' }
  const result = await manager.start(42, { ...payload, captions: [caption] })
  assert.ok(result.castId, result.error)
  assert.deepEqual(result.status.activeTrackIds, [1])
  await manager.stop(42, result.castId)
})

test('Cast owns a suspension blocker only during receiver playback and buffering', async t => {
  const starts = []
  const stops = []
  const manager = await managerForTest(t, { start(type) { starts.push(type); return starts.length - 1 }, stop(id) { stops.push(id) } })
  if (!manager) return
  const result = await manager.start(42, payload)
  assert.ok(result.castId)
  assert.deepEqual(starts, ['prevent-app-suspension'])
  await manager.status(42, result.castId)
  assert.equal(starts.length, 1)
  await manager.control(42, result.castId, 'pause')
  assert.deepEqual(stops, [0])
  await manager.control(42, result.castId, 'play')
  assert.equal(starts.length, 2)
  const cast = manager.active
  cast.sender.emit('message', CAST_MEDIA, { type: 'MEDIA_STATUS', status: [{ mediaSessionId: cast.mediaSessionId, playerState: 'BUFFERING' }] })
  assert.equal(starts.length, 2)
  assert.deepEqual(stops, [0])
  await manager.control(42, result.castId, 'seek', 120)
  assert.deepEqual(stops, [0, 1])
  await manager.stop(42, result.castId)
  assert.deepEqual(stops, [0, 1])
})

test('Cast exposes buffering separately from the receiver pause state', async t => {
  const manager = await managerForTest(t)
  if (!manager) return
  const result = await manager.start(42, payload)
  assert.ok(result.castId)
  const cast = manager.active
  cast.sender.send = async () => ({})
  for (const [playerState, paused, buffering] of [
    ['PLAYING', false, false], ['BUFFERING', false, true], ['PAUSED', true, false]
  ]) {
    cast.sender.emit('message', CAST_MEDIA, { type: 'MEDIA_STATUS', status: [{ mediaSessionId: cast.mediaSessionId, playerState }] })
    const status = await manager.status(42, result.castId)
    assert.equal(status.paused, paused, playerState)
    assert.equal(status.buffering, buffering, playerState)
  }
})

for (const cleanup of ['stop', 'disconnect', 'empty status', 'replaced media', 'status timeout']) {
  test(`Cast releases its suspension blocker once on ${cleanup}`, async t => {
    const ids = new Set()
    const manager = await managerForTest(t, {
      start(type) { assert.equal(type, 'prevent-app-suspension'); ids.add(0); return 0 },
      stop(id) { assert.ok(ids.delete(id), 'Blocker released exactly once') }
    })
    if (!manager) return
    assert.ok((await manager.start(42, { ...payload, paused: true })).castId)
    assert.equal(ids.size, 0)
    await manager.stop()
    assert.match((await manager.start(42, { ...payload, title: 'Reject media' })).error, /LOAD_FAILED/)
    assert.equal(ids.size, 0)
    const result = await manager.start(42, payload)
    assert.equal(ids.size, 1)
    const cast = manager.active
    if (cleanup === 'stop') await manager.stop()
    if (cleanup === 'disconnect') cast.sender.close()
    if (cleanup === 'empty status') cast.sender.emit('message', CAST_MEDIA, { type: 'MEDIA_STATUS', status: [] })
    if (cleanup === 'replaced media') cast.sender.emit('message', CAST_MEDIA, { type: 'MEDIA_STATUS', status: [{ mediaSessionId: 999, playerState: 'PLAYING' }] })
    if (cleanup === 'status timeout') {
      cast.sender.send = () => Promise.reject(new Error('Disconnected'))
      await manager.status(42, result.castId)
    }
    assert.equal(manager.active, null)
    assert.equal(ids.size, 0)
    manager.cleanup(cast)
    assert.equal(ids.size, 0)
  })
}

test('owns one session, forwards controls, and returns the remote position and pause state', async t => {
  const manager = await managerForTest(t)
  if (!manager) return
  const cast = await manager.start(42, payload)
  assert.ok(cast.castId, JSON.stringify(cast))
  assert.equal(cast.status.currentTime, 12)
  assert.deepEqual(cast.status.activeTrackIds, [1])
  assert.match((await manager.start(99, payload)).error, /already casting/)
  assert.equal((await manager.status(99, cast.castId)).connected, false)
  assert.equal((await manager.stop(99, cast.castId)).connected, false)
  assert.match((await manager.control(99, cast.castId, 'pause')).error, /unavailable/)
  assert.equal((await manager.control(42, cast.castId, 'pause')).paused, true)
  const seek = await manager.control(42, cast.castId, 'seek', 45)
  assert.equal(seek.currentTime, 45)
  assert.equal(seek.paused, true)
  assert.equal((await manager.control(42, cast.castId, 'volume', 0.2)).volume, 0.2)
  assert.equal((await manager.control(42, cast.castId, 'mute', true)).muted, true)
  assert.deepEqual((await manager.control(42, cast.castId, 'caption', 0)).activeTrackIds, [])
  assert.deepEqual((await manager.control(42, cast.castId, 'caption', 1)).activeTrackIds, [1])
  assert.equal((await manager.control(42, cast.castId, 'play')).paused, false)
  const status = await manager.status(42, cast.castId)
  assert.equal(status.volume, 0.2)
  assert.equal(status.muted, true)
  const endpoint = manager.active.mediaUrl
  const stopped = await manager.stop(42, cast.castId)
  assert.equal(stopped.currentTime, 45)
  assert.equal(stopped.paused, false)
  assert.equal(stopped.connected, false)
  assert.equal(manager.active, null)
  await assert.rejects(fetch(endpoint))
})

test('an empty receiver media status closes the endpoint and releases the session', async t => {
  const manager = await managerForTest(t)
  if (!manager) return
  const result = await manager.start(42, payload)
  assert.ok(result.castId)
  const cast = manager.active
  cast.sender.emit('message', CAST_MEDIA, { type: 'MEDIA_STATUS', status: [] })
  assert.equal(manager.active, null)
  assert.equal((await manager.status(42, result.castId)).connected, false)
  await assert.rejects(fetch(cast.mediaUrl))
})

test('failed loads release resources and allow a subsequent cast', async t => {
  const manager = await managerForTest(t)
  if (!manager) return
  assert.match((await manager.start(42, { ...payload, title: 'Reject media' })).error, /LOAD_FAILED/)
  assert.equal(manager.active, null)
  assert.equal(manager.starting, false)
  const result = await manager.start(42, payload)
  assert.ok(result.castId)
  for (const [action, value] of [['seek', -1], ['volume', 2], ['mute', 'true'], ['caption', 99], ['launch', 'other-app']]) {
    assert.ok((await manager.control(42, result.castId, action, value)).error)
  }
  manager.active.sender.close()
  assert.equal((await manager.status(42, result.castId)).connected, false)
  assert.equal(manager.active, null)
})


test('a final status timeout releases the session without a second response timeout', async t => {
  const manager = await managerForTest(t)
  if (!manager) return
  const cast = await manager.start(42, payload)
  const sender = manager.active.sender
  const originalSend = sender.send.bind(sender)
  sender.send = (namespace, destination, message, wait) => {
    if (message.type === 'GET_STATUS') return Promise.reject(new Error('Status timed out'))
    if (message.type === 'STOP') return new Promise((resolve, reject) => setTimeout(() => reject(new Error('Stop timed out')), 500))
    return originalSend(namespace, destination, message, wait)
  }
  const result = await Promise.race([
    manager.stop(42, cast.castId),
    new Promise(resolve => setTimeout(() => resolve('unsettled'), 100))
  ])
  assert.notEqual(result, 'unsettled')
  assert.equal(result.connected, false)
  assert.equal(result.currentTime, 12)
  assert.equal(manager.active, null)
  assert.equal(sender.closed, true)
})


test('reports only natural receiver completion as ended', async t => {
  const manager = await managerForTest(t)
  if (!manager) return
  const cast = await manager.start(42, payload)
  const cancelled = await manager.control(42, cast.castId, 'seek', 119)
  assert.equal(cancelled.ended, false)
  assert.equal(cancelled.paused, true)
  assert.equal((await manager.status(42, cast.castId)).connected, false)
  assert.equal(manager.active, null)
  const next = await manager.start(42, payload)
  assert.equal((await manager.control(42, next.castId, 'seek', 120)).ended, true)
})
