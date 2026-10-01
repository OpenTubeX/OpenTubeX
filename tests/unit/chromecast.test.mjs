import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ChromecastManager } from '../../src/main/chromecast.js'
import { CAST_MEDIA } from '../../src/main/castSender.js'

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
   media={mediaSessionId:7,currentTime:p.currentTime,playerState:p.autoplay?'PLAYING':'PAUSED',volume:{level:1,muted:false},activeTrackIds:p.activeTrackIds,media:{...p.media,tracks:undefined,duration:120}}
  }
  if(p.type==='PLAY') media.playerState='PLAYING'
  if(p.type==='PAUSE') media.playerState='PAUSED'
  if(p.type==='SEEK') {media.currentTime=p.currentTime;media.playerState=p.resumeState==='PLAYBACK_PAUSE'?'PAUSED':'PLAYING'}
  if(p.type==='EDIT_TRACKS_INFO') media.activeTrackIds=p.activeTrackIds
  if(p.type==='STOP') media.playerState='IDLE'
  response={type:'MEDIA_STATUS',status:media?[media]:[]}
 }
 output({event:'message',namespace:command.namespace,payload:{...response,requestId:command.id}})
})
lines.on('close',()=>process.exit(0))
`

async function managerForTest(t) {
  if (process.platform === 'win32') { t.skip('POSIX bridge fixture'); return null }
  const directory = await mkdtemp(path.join(tmpdir(), 'otx-cast-'))
  const executable = path.join(directory, 'sender.mjs')
  await writeFile(executable, receiver)
  await chmod(executable, 0o755)
  const manager = new ChromecastManager(executable)
  t.after(async () => { await manager.stop(); await rm(directory, { recursive: true, force: true }) })
  assert.deepEqual(await manager.discover(), [{ id: 'device', name: 'Test TV' }])
  return manager
}

const payload = {
  deviceId: 'device', title: 'Test video', startSeconds: 12, paused: false,
  source: { url: 'data:application/dash+xml,%3CMPD%2F%3E', contentType: 'application/dash+xml' },
  captions: [{ label: 'English', language: 'en', url: 'https://media.test/en.vtt' }], captionIndex: 0
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
