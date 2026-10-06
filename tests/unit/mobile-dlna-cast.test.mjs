import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'

import { createMobileDlnaCast } from '../../src/renderer/helpers/player/dlnaCast.js'
import { createPlaybackScreenWake } from '../../src/renderer/helpers/playbackScreenWake.js'
import { parseDlnaPosition, parseSsdpLocation } from '../../src/dlnaProtocol.js'

const location = 'http://192.168.1.7:8000/device.xml'
const description = `<root><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
<friendlyName>Living room TV</friendlyName><serviceList><service>
<serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
<controlURL>/control</controlURL></service></serviceList></device></root>`
const payload = { deviceId: location, mediaUrl: 'https://media.example/video.mp4', title: 'A & B', startSeconds: 65.8 }

function fixture(screenWake) {
  const calls = []
  let failure
  let streamFailed = false
  let finishStop
  const native = {
    async discover() {
      return { responses: [
        { message: `HTTP/1.1 200 OK\r\nLOCATION: ${location}\r\n`, address: '192.168.1.7' },
        { message: `HTTP/1.1 200 OK\r\nLOCATION: ${location}\r\n`, address: '192.168.1.7' },
        { message: 'LOCATION: http://192.168.1.8/private', address: '192.168.1.7' }
      ] }
    },
    async request(request) {
      calls.push(request)
      if (request.method === 'GET') return { status: 200, body: description }
      if (request.headers.SOAPACTION.includes('#Stop') && finishStop) await finishStop
      return { status: request.headers.SOAPACTION.includes(`#${failure}"`) ? 500 : 200, body: '' }
    },
    async startMediaServer(options) {
      calls.push({ start: options })
      return { castId: 'cast-1', mediaUrl: 'http://192.168.1.2:1234/token/video.mp4' }
    },
    async hasFailed() { return { failed: streamFailed } },
    async stopMediaServer(options) { calls.push({ stop: options }) }
  }
  return {
    cast: createMobileDlnaCast(native, screenWake), calls, native,
    fail(action) { failure = action },
    failStream() { streamFailed = true },
    delayStop(promise) { finishStop = promise }
  }
}

test('a mobile relay keeps the foreground screen awake after local video pauses and releases on stop', async () => {
  const wakeCalls = []
  const wake = createPlaybackScreenWake({
    async keepAwake() { wakeCalls.push('awake') },
    async allowSleep() { wakeCalls.push('sleep') }
  })
  const video = Object.assign(new EventTarget(), { paused: false, ended: false })
  const binding = wake.bindVideo(video, () => true)
  wake.setAppActive(true)
  const { cast } = fixture(wake)
  await cast.discover()
  await cast.start(payload)
  video.paused = true
  video.dispatchEvent(new Event('pause'))
  await setImmediate()
  assert.equal(wakeCalls.at(-1), 'awake', 'pausing local playback must not allow the casting phone to auto-lock')
  wake.setAppActive(false)
  await setImmediate()
  assert.equal(wakeCalls.at(-1), 'sleep')
  wake.setAppActive(true)
  await setImmediate()
  assert.equal(wakeCalls.at(-1), 'awake', 'returning to the relay reacquires screen wake')
  assert.equal(await cast.stop('wrong-cast'), false)
  await setImmediate()
  assert.equal(wakeCalls.at(-1), 'awake')
  await cast.stop('cast-1')
  await setImmediate()
  assert.equal(wakeCalls.at(-1), 'sleep')
  binding.destroy()
})

test('failed mobile cast startup and failed relay teardown leave sleep allowed', async () => {
  const calls = []
  const wake = createPlaybackScreenWake({
    async keepAwake() { calls.push('awake') },
    async allowSleep() { calls.push('sleep') }
  })
  wake.setAppActive(true)
  const setup = fixture(wake)
  await setup.cast.discover()
  setup.fail('Play')
  assert.ok((await setup.cast.start(payload)).error)
  await setImmediate()
  assert.equal(calls.at(-1), 'sleep')
  assert.equal(calls.includes('awake'), false)
  setup.fail(undefined)
  await setup.cast.start(payload)
  await setImmediate()
  assert.equal(calls.at(-1), 'awake')
  setup.native.stopMediaServer = async () => { throw new Error('relay closed') }
  await assert.rejects(setup.cast.stop('cast-1'), /relay closed/)
  await setImmediate()
  assert.equal(calls.at(-1), 'sleep')
})

function actions(calls) {
  return calls.filter(call => call.method === 'POST').map(call => call.headers.SOAPACTION.split('#')[1].slice(0, -1))
}

test('mobile discovery deduplicates responses and pins endpoints to their responding device', async () => {
  const { cast, calls } = fixture()
  assert.deepEqual(await cast.discover(), [{ id: location, name: 'Living room TV' }])
  assert.equal(calls.length, 1)
  assert.equal(parseSsdpLocation('LOCATION: https://192.168.1.7/device.xml', '192.168.1.7'), null)
  assert.equal(parseSsdpLocation('LOCATION: http://tv.local:8000/device.xml', '192.168.1.7'), location)
})

test('mobile cast uses the native relay, escaped metadata, start position and stop cleanup', async () => {
  const { cast, calls } = fixture()
  await cast.discover()
  assert.deepEqual(await cast.start(payload), { castId: 'cast-1', deviceName: 'Living room TV' })
  assert.deepEqual(actions(calls), ['SetAVTransportURI', 'Play', 'Seek'])
  assert.deepEqual(calls[1].start, { mediaUrl: payload.mediaUrl, address: '192.168.1.7' })
  assert.match(calls[2].body, /A &amp;amp; B/)
  assert.match(calls[2].body, /http:\/\/192.168.1.2:1234\/token\/video.mp4/)
  assert.match(calls[4].body, /<Target>00:01:05<\/Target>/)
  assert.equal(await cast.stop('wrong-cast'), false)
  assert.match((await cast.start(payload)).error, /already casting/)
  assert.equal(await cast.stop('cast-1'), true)
  assert.deepEqual(actions(calls), ['SetAVTransportURI', 'Play', 'Seek', 'Stop'])
  assert.deepEqual(calls.at(-1), { stop: { castId: 'cast-1' } })
})

test('failed Play stops the device and closes the native media relay before retrying', async () => {
  const setup = fixture()
  await setup.cast.discover()
  setup.fail('Play')
  assert.match((await setup.cast.start(payload)).error, /HTTP 500/)
  assert.deepEqual(actions(setup.calls), ['SetAVTransportURI', 'Play', 'Stop'])
  assert.deepEqual(setup.calls.at(-1), { stop: { castId: 'cast-1' } })
  setup.fail(undefined)
  assert.ok((await setup.cast.start(payload)).castId)
})

test('failed URI setup closes the relay and optional seek failure does not fail casting', async () => {
  const setup = fixture()
  await setup.cast.discover()
  setup.fail('SetAVTransportURI')
  assert.match((await setup.cast.start(payload)).error, /HTTP 500/)
  assert.deepEqual(actions(setup.calls), ['SetAVTransportURI'])
  assert.deepEqual(setup.calls.at(-1), { stop: { castId: 'cast-1' } })
  setup.fail('Seek')
  assert.ok((await setup.cast.start(payload)).castId)
})

test('rejects unknown devices and invalid media without opening a relay', async () => {
  const { cast, calls } = fixture()
  assert.ok((await cast.start(payload)).error)
  await cast.discover()
  assert.ok((await cast.start({ ...payload, mediaUrl: 'file:///private/video.mp4' })).error)
  assert.ok((await cast.start({ ...payload, title: 'x'.repeat(501) })).error)
  assert.equal(calls.filter(call => call.start).length, 0)
})

test('a pending startup or stop cannot overlap another cast', async () => {
  const setup = fixture()
  await setup.cast.discover()
  const starting = setup.cast.start(payload)
  assert.match((await setup.cast.start(payload)).error, /already casting/)
  await starting
  let release
  setup.delayStop(new Promise(resolve => { release = resolve }))
  const stopping = setup.cast.stop('cast-1')
  assert.match((await setup.cast.start(payload)).error, /already casting/)
  release()
  await stopping
  assert.ok((await setup.cast.start(payload)).castId)
})

test('passes registered iOS media to the native relay without exposing its original headers', async () => {
  const { cast, calls } = fixture()
  await cast.discover()
  const mediaUrl = 'capacitor://localhost/_opentubex_media/5CD72AC0-BA1B-402B-9BA3-81455F753D8A'
  assert.ok((await cast.start({ ...payload, mediaUrl })).castId)
  assert.deepEqual(calls[1].start, { mediaUrl, address: '192.168.1.7' })
})


test('merged casting passes both tracks and start time to native without sending an unsupported Seek', async () => {
  const { cast, calls } = fixture()
  await cast.discover()
  const audioUrl = 'capacitor://localhost/_opentubex_media/ABC-123'
  assert.ok((await cast.start({ ...payload, audioUrl })).castId)
  assert.deepEqual(calls[1].start, { mediaUrl: payload.mediaUrl, audioUrl, startSeconds: payload.startSeconds, address: '192.168.1.7' })
  assert.deepEqual(actions(calls), ['SetAVTransportURI', 'Play'])
  assert.match(calls[2].body, /DLNA.ORG_OP=00/)
  await cast.stop('cast-1')
  assert.ok((await cast.start({ ...payload, audioUrl: 'file:///private/audio' })).error)
})


test('a failed merged relay can recover through the complete source without another user gesture', async () => {
  const setup = fixture()
  await setup.cast.discover()
  await setup.cast.start({ ...payload, audioUrl: 'https://media.example/audio.m4a' })
  assert.equal(await setup.cast.hasFailed('cast-1'), false)
  assert.ok((await setup.cast.recover('cast-1', payload)).error)
  setup.failStream()
  assert.ok((await setup.cast.recover('wrong-cast', payload)).error)
  assert.ok((await setup.cast.recover('cast-1', { ...payload, audioUrl: 'https://media.example/audio.m4a' })).error)
  assert.ok((await setup.cast.recover('cast-1', payload)).castId)
  assert.deepEqual(actions(setup.calls), ['SetAVTransportURI', 'Play', 'GetPositionInfo', 'Stop', 'SetAVTransportURI', 'Play', 'Seek'])
  assert.deepEqual(setup.calls.filter(call => call.start).at(-1).start, { mediaUrl: payload.mediaUrl, address: '192.168.1.7' })
})


test('recovery uses the renderer position plus the merged source offset', async () => {
  const setup = fixture()
  const request = setup.native.request
  setup.native.request = async options => {
    const result = await request(options)
    return options.headers?.SOAPACTION?.includes('#GetPositionInfo')
      ? { ...result, body: '<s:Envelope><s:Body><u:GetPositionInfoResponse><RelTime>00:00:08</RelTime></u:GetPositionInfoResponse></s:Body></s:Envelope>' }
      : result
  }
  await setup.cast.discover()
  await setup.cast.start({ ...payload, audioUrl: 'https://media.example/audio.m4a' })
  setup.failStream()
  assert.ok((await setup.cast.recover('cast-1', payload)).castId)
  assert.match(setup.calls.at(-1).body, /<Target>00:01:13<\/Target>/)
})

test('recovery uses the native keyframe base rather than the requested start', async () => {
  for (const baseSeconds of [60, 0]) {
    const setup = fixture()
    const request = setup.native.request
    setup.native.request = async options => {
      const result = await request(options)
      return options.headers?.SOAPACTION?.includes('#GetPositionInfo')
        ? { ...result, body: '<response><RelTime>00:00:10</RelTime></response>' }
        : result
    }
    await setup.cast.discover()
    await setup.cast.start({ ...payload, startSeconds: 65, audioUrl: 'https://media.example/audio.m4a' })
    setup.native.hasFailed = async () => ({ failed: true, baseSeconds })
    assert.ok((await setup.cast.recover('cast-1', { ...payload, startSeconds: 65 })).castId)
    assert.match(setup.calls.at(-1).body, new RegExp(`<Target>00:${baseSeconds === 60 ? '01:10' : '00:10'}<\\/Target>`))
    await setup.cast.stop('cast-1')
  }
})


test('renderer position parsing accepts valid SOAP time and rejects unavailable or malformed values', () => {
  assert.equal(parseDlnaPosition('<response><RelTime>01:02:03.5</RelTime></response>'), 3723.5)
  assert.equal(parseDlnaPosition('<response><upnp:RelTime><![CDATA[00:00:12]]></upnp:RelTime></response>'), 12)
  assert.equal(parseDlnaPosition('<response><RelTime>NOT_IMPLEMENTED</RelTime></response>'), null)
  assert.equal(parseDlnaPosition('<response><RelTime>00:64:00</RelTime></response>'), null)
  assert.equal(parseDlnaPosition('<response><RelTime>12</RelTime>'), null)
})

test('private instance credentials reach only the scoped native relay, including recovery', async () => {
  const setup = fixture()
  await setup.cast.discover()
  const authorization = { url: 'https://private.example/invidious', value: 'Basic fixture' }
  const privatePayload = { ...payload, mediaUrl: authorization.url + '/video', audioUrl: authorization.url + '/audio', authorization }
  await setup.cast.start(privatePayload)
  assert.deepEqual(setup.calls.find(call => call.start).start.authorization, authorization)
  assert.equal(setup.calls.filter(call => call.method).some(call => JSON.stringify(call).includes(authorization.value)), false)
  setup.failStream()
  await setup.cast.recover('cast-1', { ...privatePayload, mediaUrl: authorization.url + '/complete.mp4', audioUrl: undefined })
  assert.deepEqual(setup.calls.filter(call => call.start).at(-1).start.authorization, authorization)
  await setup.cast.stop('cast-1')
  for (const mediaUrl of ['https://private.example.evil/invidious/video', 'https://private.example/invidious-other/video', 'http://private.example/invidious/video', payload.mediaUrl]) {
    await setup.cast.start({ ...payload, mediaUrl, authorization })
    assert.equal(setup.calls.filter(call => call.start).at(-1).start.authorization, undefined)
    await setup.cast.stop('cast-1')
  }
})

test('native mux startup rejection retries a complete source with its scoped credentials and seek', async () => {
  const setup = fixture()
  await setup.cast.discover()
  const start = setup.native.startMediaServer
  setup.native.startMediaServer = async options => {
    if (options.audioUrl) { setup.calls.push({ start: options }); throw new Error('FFmpeg initialization failed') }
    return start(options)
  }
  const authorization = { url: 'https://private.example/invidious', value: 'Basic fixture' }
  const fallbackMediaUrl = authorization.url + '/complete.mp4'
  assert.deepEqual(await setup.cast.start({ ...payload, audioUrl: 'https://media.example/audio', fallbackMediaUrl, authorization }), { castId: 'cast-1', deviceName: 'Living room TV', usedFallback: true })
  const attempts = setup.calls.filter(call => call.start)
  assert.equal(attempts.length, 2)
  assert.equal(attempts[0].start.authorization, undefined)
  assert.deepEqual(attempts[1].start, { mediaUrl: fallbackMediaUrl, address: '192.168.1.7', authorization })
  assert.deepEqual(actions(setup.calls), ['SetAVTransportURI', 'Play', 'Seek'])
  assert.match(setup.calls.find(call => call.body?.includes('CurrentURIMetaData')).body, /DLNA.ORG_OP=01/)
  assert.match(setup.calls.at(-1).body, /<Target>00:01:05<\/Target>/)
  await setup.cast.stop('cast-1')
})

test('startup fallback keeps serialization and failed retries leave no active cast', async () => {
  const setup = fixture()
  await setup.cast.discover()
  let release
  const blocked = new Promise(resolve => { release = resolve })
  const start = setup.native.startMediaServer
  setup.native.startMediaServer = async options => {
    await blocked
    if (options.audioUrl) throw new Error('mux unavailable')
    throw new Error('fallback unavailable')
  }
  const pending = setup.cast.start({ ...payload, audioUrl: 'https://media.example/audio', fallbackMediaUrl: payload.mediaUrl })
  assert.match((await setup.cast.start(payload)).error, /already casting/)
  release()
  assert.match((await pending).error, /fallback unavailable/)
  setup.native.startMediaServer = start
  assert.ok((await setup.cast.start(payload)).castId)
  await setup.cast.stop('cast-1')
})

test('an explicit native stop cannot be recovered as a mux failure', async () => {
  let released = 0
  const setup = fixture({ acquire: () => () => { released++ } })
  await setup.cast.discover()
  await setup.cast.start({ ...payload, audioUrl: 'https://media.example/audio' })
  setup.native.hasFailed = async () => ({ failed: true, stopped: true })
  assert.equal(await setup.cast.hasStopped('cast-1'), true)
  assert.equal(await setup.cast.hasFailed('cast-1'), false)
  assert.ok((await setup.cast.recover('cast-1', payload)).error)
  assert.equal(setup.calls.filter(call => call.start).length, 1)
  await setup.cast.stop('cast-1')
  assert.equal(released, 1)
})
