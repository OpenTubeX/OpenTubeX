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
    async registerResources(options) {
      for (const id of options.removeResourceIds ?? []) {
        const index = resources.findIndex(resource => resource.id === id)
        if (index >= 0) resources.splice(index, 1)
      }
      for (const resource of options.resources) {
        assert.ok(!resources.some(existing => existing.id === resource.id), 'Resource IDs must remain unique after retirement')
        resources.push(resource)
      }
    },
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

test('Android preserves DASH placeholders in segment query strings', async t => {
  const fixture = nativeFixture()
  const api = createMobileChromecast(fixture.native, { acquire() { return () => {} } })
  await api.discover()
  const result = await api.start(() => handoff)
  t.after(() => api.stop(result.castId))
  await fixture.event('castManifest', { requestId: 'query-template', resourceId: 0, url: 'https://media.test/live/manifest.mpd',
    contentType: 'application/dash+xml', body: '<MPD><Period><AdaptationSet><Representation id="video"><SegmentTemplate media="segment.mp4?number=$Number$&amp;time=$Time$"/></Representation></AdaptationSet></Period></MPD>' })
  assert.match(fixture.completed.at(-1).body, /\/segment\.mp4\?number=\$Number\$&amp;time=\$Time\$/)
  assert.ok(fixture.resources.some(resource => resource.candidates.some(candidate =>
    candidate.template && candidate.url === 'https://media.test/live/' && candidate.suffix === 'segment.mp4?number=$Number$&time=$Time$')))
})

for (const format of ['hls', 'dash']) {
  test(`Android retires obsolete ${format} resources after the playback window`, async t => {
    let now = 0
    t.mock.method(Date, 'now', () => now)
    const fixture = nativeFixture()
    const api = createMobileChromecast(fixture.native, { acquire() { return () => {} } })
    await api.discover()
    const result = await api.start(() => handoff)
    t.after(() => api.stop(result.castId))
    const update = index => fixture.event('castManifest', { requestId: `refresh-${index}`, resourceId: 0,
      url: `https://media.test/manifest.${format === 'hls' ? 'm3u8' : 'mpd'}`,
      contentType: format === 'hls' ? 'application/x-mpegurl' : 'application/dash+xml',
      body: format === 'hls'
        ? `#EXTM3U\n#EXT-X-TARGETDURATION:150\n#EXTINF:150,\nsegment-${index}.ts`
        : `<MPD type="dynamic" timeShiftBufferDepth="PT6M" maxSegmentDuration="PT30S" minimumUpdatePeriod="PT30S"><Period><AdaptationSet><Representation><SegmentList><SegmentURL media="segment-${index}.m4s"/></SegmentList></Representation></AdaptationSet></Period></MPD>` })
    await update(0)
    const first = fixture.resources.find(resource => resource.candidates[0].url.includes('segment-0.'))
    now = 1000
    await update(1)
    now = 122_000
    await update(2)
    assert.ok(fixture.resources.includes(first), 'Retain stale segments beyond the minimum grace when the stream has a longer window')
    now = 452_000
    await update(3)
    assert.ok(!fixture.resources.includes(first), 'Retire the obsolete segment after its complete playback window')
    for (let index = 4; index < 20; index++) {
      now += 451_000
      await update(index)
      assert.equal(fixture.completed.at(-1).error, undefined)
      assert.ok(fixture.resources.length <= 5, 'Repeated live refreshes keep the native registry bounded')
    }
    assert.ok(fixture.resources.some(resource => resource.id === 0), 'Keep the session manifest root')
    assert.ok(fixture.resources.some(resource => resource.contentType === 'text/vtt'), 'Keep session captions')
  })
}

test('Android retires unreachable HLS rendition cycles while retaining referenced playlists', async t => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const fixture = nativeFixture()
  const api = createMobileChromecast(fixture.native, { acquire() { return () => {} } })
  await api.discover()
  const result = await api.start(() => handoff)
  t.after(() => api.stop(result.castId))
  const update = (id, file, body) => fixture.event('castManifest', {
    requestId: `${file}-${now}`, resourceId: id, url: `https://media.test/${file}`, contentType: 'application/x-mpegurl', body
  })
  const root = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\na.m3u8'
  await update(0, 'master.m3u8', root)
  const a = fixture.resources.find(resource => resource.candidates[0].url.endsWith('/a.m3u8'))
  await update(a.id, 'a.m3u8', '#EXTM3U\n#EXT-X-RENDITION-REPORT:URI="b.m3u8"\n#EXTINF:6,\na.ts')
  const b = fixture.resources.find(resource => resource.candidates[0].url.endsWith('/b.m3u8'))
  await update(b.id, 'b.m3u8', '#EXTM3U\n#EXT-X-RENDITION-REPORT:URI="a.m3u8"\n#EXTINF:6,\nb.ts')
  now = 121_000
  await update(0, 'master.m3u8', root)
  assert.ok(fixture.resources.includes(a) && fixture.resources.includes(b), 'Reachable rendition references remain usable')
  await update(0, 'master.m3u8', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nnew.m3u8')
  now += 121_000
  await update(0, 'master.m3u8', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nnew.m3u8')
  assert.ok(!fixture.resources.includes(a) && !fixture.resources.includes(b), 'A rendition cycle cannot retain itself after the root drops it')
  assert.ok(!fixture.resources.some(resource => /\/[ab]\.ts$/.test(resource.candidates[0].url)))
})

test('Android DASH Location refreshes release previous manifest chains', async t => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const fixture = nativeFixture()
  const api = createMobileChromecast(fixture.native, { acquire() { return () => {} } })
  await api.discover()
  const result = await api.start(() => handoff)
  t.after(() => api.stop(result.castId))
  let id = 0
  for (let index = 0; index < 10; index++) {
    now += 121_000
    await fixture.event('castManifest', { requestId: `location-${index}`, resourceId: id,
      url: `https://media.test/manifest-${index}.mpd`, contentType: 'application/dash+xml',
      body: `<MPD type="dynamic"><Location>manifest-${index + 1}.mpd</Location><Period><AdaptationSet><Representation><SegmentList><SegmentURL media="segment-${index}.m4s"/></SegmentList></Representation></AdaptationSet></Period></MPD>` })
    assert.equal(fixture.completed.at(-1).error, undefined)
    id = fixture.resources.find(resource => resource.candidates[0].url.endsWith(`/manifest-${index + 1}.mpd`)).id
    assert.ok(fixture.resources.length <= 7, 'Advancing Location must not keep the complete previous manifest chain reachable')
  }
  assert.ok(!fixture.resources.some(resource => resource.candidates[0].url.endsWith('/segment-0.m4s')))
  assert.ok(fixture.resources.some(resource => resource.id === 0), 'The original session URL stays registered')
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
