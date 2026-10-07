import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileFunction } from 'node:vm'
import test from 'node:test'

test('Android exposes the Google Cast setting and enabled player action', async () => {
  const settings = await readFile(new URL('../../src/renderer/components/PlayerSettings/PlayerSettings.vue', import.meta.url), 'utf8')
  const toggle = settings.match(/<FtToggleSwitch\s[^>]*setting-key="showChromecastButton"[^>]*>/s)?.[0]
  assert.ok(toggle)
  const condition = toggle.match(/v-if="([^"]+)"/)?.[1] ?? 'true'
  assert.equal(compileFunction(`return ${condition}`, ['USING_ELECTRON', 'IS_CAPACITOR', 'IS_IOS'])(false, true, false), true,
    'Google Cast setting is missing on Android')
  const watch = await readFile(new URL('../../src/renderer/views/Watch/Watch.vue', import.meta.url), 'utf8')
  const action = watch.match(/<WatchChromecast\s[^>]*>/s)?.[0]
  const visible = action.match(/v-if="([^"]+)"/)[1]
  assert.equal(compileFunction(`return ${visible}`, ['supportsChromecast', '$store'])(true,
    { getters: { getShowChromecastButton: true } }), true, 'Enabled Google Cast action is missing on Android')
})

const { createMobileChromecast } = await import('../../src/renderer/helpers/player/chromecast.js')

function nativeFixture() {
  const listeners = new Map()
  const resources = []
  const completed = []
  const calls = []
  let media
  let nativeId
  let rejectLoad = false
  let closed = false
  const native = {
    async addListener(event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(callback)
      return { async remove() { listeners.get(event).delete(callback) } }
    },
    async discover() { return { devices: [{ id: 'tv', name: 'Test TV', address: '192.168.1.7', port: 8009 }] } },
    async connect(options) { calls.push(['connect', options]); nativeId = options.castId; closed = false; return { address: '192.168.1.2' } },
    async openMedia(options) { calls.push(['openMedia', options]); return { origin: 'http://192.168.1.2:8000' } },
    async registerResources(options) { resources.push(...options.resources) },
    async completeManifest(options) { completed.push(options) },
    async disconnect() { closed = true; calls.push(['disconnect']) },
    async send(options) {
      calls.push(['send', options])
      const payload = options.payload
      if (options.wait === false) return {}
      if (options.namespace.endsWith('.receiver')) {
        return { type: 'RECEIVER_STATUS', status: { applications: [{ appId: 'CC1AD845', transportId: 'transport', sessionId: 'session' }], volume: { level: 0.5, muted: false } } }
      }
      if (payload.type === 'LOAD') {
        if (rejectLoad) throw new Error('Cast LOAD_FAILED')
        media = { mediaSessionId: 7, currentTime: payload.currentTime, playerState: payload.autoplay ? 'PLAYING' : 'PAUSED',
          activeTrackIds: payload.activeTrackIds, playbackRate: payload.playbackRate, media: { ...payload.media, duration: 120 } }
      }
      if (payload.type === 'PAUSE') media.playerState = 'PAUSED'
      if (payload.type === 'PLAY') media.playerState = 'PLAYING'
      if (payload.type === 'SEEK') media.currentTime = payload.currentTime
      if (payload.type === 'EDIT_TRACKS_INFO') media.activeTrackIds = payload.activeTrackIds
      if (payload.type === 'STOP') media.playerState = 'IDLE'
      return { type: 'MEDIA_STATUS', status: [structuredClone(media)] }
    }
  }
  return {
    native, calls, resources, completed,
    failLoad() { rejectLoad = true },
    get closed() { return closed },
    async event(name, value) { await Promise.all([...listeners.get(name) ?? []].map(listener => listener({ castId: nativeId, ...value }))) },
    listenerCount() { return [...listeners.values()].reduce((sum, value) => sum + value.size, 0) }
  }
}
const handoff = {
  deviceId: 'tv', title: 'Android Cast test', startSeconds: 12, paused: false, playbackRate: 1.5,
  source: { url: 'data:application/dash+xml,%3CMPD%2F%3E', contentType: 'application/dash+xml' },
  captions: [{ url: 'data:text/vtt;charset=utf-8,WEBVTT%0A%0ACaption', label: 'English', language: 'en' }], captionIndex: 0
}

test('Android uses the native sender and relay for handoff, captions, controls and return', async t => {
  const fixture = nativeFixture()
  const wake = []
  const api = createMobileChromecast(fixture.native, { acquire() { wake.push('awake'); return () => wake.push('sleep') } })
  await api.discover()
  const result = await api.start(() => handoff)
  t.after(() => api.stop(result.castId))
  assert.ok(result.castId, result.error)
  assert.equal(result.status.currentTime, 12)
  assert.equal(result.status.paused, false)
  const load = fixture.calls.find(([name, options]) => name === 'send' && options.payload.type === 'LOAD')[1].payload
  assert.equal(load.playbackRate, 1.5)
  assert.deepEqual(load.activeTrackIds, [1])
  assert.match(load.media.contentId, /^http:\/\/192\.168\.1\.2:8000\/[a-f0-9-]+\/0\/media$/)
  assert.equal(fixture.resources.length, 2)
  assert.deepEqual(wake, ['awake'])
  assert.equal((await api.control(result.castId, 'pause')).paused, true)
  assert.deepEqual(wake, ['awake', 'sleep'])
  assert.equal((await api.control(result.castId, 'seek', 45)).currentTime, 45)
  assert.equal((await api.control(result.castId, 'play')).paused, false)
  assert.deepEqual((await api.control(result.castId, 'caption', 0)).activeTrackIds, [])
  const stopped = await api.stop(result.castId)
  assert.equal(stopped.connected, false)
  assert.equal(stopped.currentTime, 45)
  assert.equal(fixture.closed, true)
  assert.equal(fixture.listenerCount(), 0)
  assert.deepEqual(wake, ['awake', 'sleep', 'awake', 'sleep'])
})

test('native disconnect and failed Android handoffs release relay listeners and wake ownership', async () => {
  for (const failed of [false, true]) {
    const fixture = nativeFixture()
    if (failed) fixture.failLoad()
    let awake = 0
    const api = createMobileChromecast(fixture.native, { acquire() { awake++; return () => awake-- } })
    await api.discover()
    const result = await api.start(() => handoff)
    if (failed) assert.match(result.error, /LOAD_FAILED/)
    else await fixture.event('castEvent', { event: 'closed' })
    assert.equal(awake, 0)
    assert.equal(fixture.closed, true)
    assert.equal(fixture.listenerCount(), 0)
    assert.equal((await api.status(result.castId)).connected, false)
  }
})

test('Android rewrites DASH templates and HLS child playlists before replying to the native relay', async t => {
  const fixture = nativeFixture()
  const api = createMobileChromecast(fixture.native, { acquire() { return () => {} } })
  await api.discover()
  const result = await api.start(() => handoff)
  t.after(() => api.stop(result.castId))
  const root = fixture.resources.find(resource => resource.contentType === 'application/dash+xml')
  await fixture.event('castManifest', { requestId: 'dash', resourceId: root.id, url: 'https://media.test/manifest.mpd',
    contentType: 'application/dash+xml', body: '<MPD><Period><AdaptationSet><Representation id="video"><SegmentTemplate media="parts/$Number$.m4s" initialization="init.mp4"/></Representation></AdaptationSet></Period></MPD>' })
  assert.match(fixture.completed[0].body, /http:\/\/192\.168\.1\.2:8000\/[^/]+\/\d+\/\$Number\$\.m4s/)
  const template = fixture.resources.find(resource => resource.candidates[0].template)
  assert.equal(template.candidates[0].url, 'https://media.test/parts/')
  await fixture.event('castManifest', { requestId: 'hls', resourceId: root.id, url: 'https://media.test/master.m3u8',
    contentType: 'application/x-mpegurl', body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nvideo.m3u8' })
  assert.match(fixture.completed[1].body, /http:\/\/192\.168\.1\.2:8000\//)
  assert.ok(fixture.resources.some(resource => resource.contentType === 'application/x-mpegurl' && resource.candidates[0].url === 'https://media.test/video.m3u8'))
})
