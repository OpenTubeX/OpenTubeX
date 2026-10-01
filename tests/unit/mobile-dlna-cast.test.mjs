import assert from 'node:assert/strict'
import test from 'node:test'

import { createMobileDlnaCast } from '../../src/renderer/helpers/player/dlnaCast.js'
import { parseSsdpLocation } from '../../src/dlnaProtocol.js'

const location = 'http://192.168.1.7:8000/device.xml'
const description = `<root><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
<friendlyName>Living room TV</friendlyName><serviceList><service>
<serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
<controlURL>/control</controlURL></service></serviceList></device></root>`
const payload = { deviceId: location, mediaUrl: 'https://media.example/video.mp4', title: 'A & B', startSeconds: 65.8 }

function fixture() {
  const calls = []
  let failure
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
    async stopMediaServer(options) { calls.push({ stop: options }) }
  }
  return {
    cast: createMobileDlnaCast(native), calls, native,
    fail(action) { failure = action },
    delayStop(promise) { finishStop = promise }
  }
}

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
