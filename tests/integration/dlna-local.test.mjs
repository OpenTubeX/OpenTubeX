import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { createServer } from 'node:http'
import test from 'node:test'

import { discoverDlnaDevices, startDlnaCast, stopDlnaCast } from '../../src/main/dlnaCast.js'

const DEVICE_NAME = 'OpenTubeX local DLNA test renderer'
const DESCRIPTION = `<?xml version="1.0"?>
<root><device>
  <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
  <friendlyName>${DEVICE_NAME}</friendlyName>
  <serviceList><service>
    <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
    <controlURL>/control</controlURL>
  </service></serviceList>
</device></root>`

function listen (server) {
  return new Promise(resolve => server.listen(0, '0.0.0.0', () => resolve(server.address().port)))
}

async function close (server) {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}

test('discovers a local renderer and plays a ranged MP4 through the proxy', { timeout: 20_000 }, async t => {
  const actions = []
  const upstreamRanges = []
  let mediaUri
  let mediaStatus
  let mediaBytes
  let failPlay = false

  const upstream = createServer((request, response) => {
    upstreamRanges.push(request.headers.range)
    response.writeHead(206, {
      'content-type': 'video/mp4',
      'content-range': 'bytes 2-5/10',
      'content-length': 4,
      'accept-ranges': 'bytes'
    }).end('cdef')
  })
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))

  const renderer = createServer(async (request, response) => {
    if (request.url === '/device.xml') {
      response.writeHead(200, { 'content-type': 'text/xml' }).end(DESCRIPTION)
      return
    }
    const body = await new Promise(resolve => {
      let value = ''
      request.on('data', chunk => { value += chunk })
      request.on('end', () => resolve(value))
    })
    const action = request.headers.soapaction?.match(/#([A-Za-z]+)"$/)?.[1]
    actions.push(action)
    if (action === 'SetAVTransportURI') {
      mediaUri = body.match(/<CurrentURI>([^<]+)<\/CurrentURI>/)?.[1]
    }
    if (action === 'Play') {
      if (failPlay) {
        response.writeHead(500).end()
        return
      }
      const media = await fetch(mediaUri, { headers: { Range: 'bytes=2-5' } })
      mediaStatus = media.status
      mediaBytes = await media.text()
    }
    response.writeHead(200, { 'content-type': 'text/xml' }).end('<ok/>')
  })
  const rendererPort = await listen(renderer)
  t.after(() => close(renderer))

  const ssdp = createSocket({ type: 'udp4', reuseAddr: true })
  await new Promise((resolve, reject) => {
    ssdp.once('error', reject)
    ssdp.bind(1900, '0.0.0.0', resolve)
  })
  t.after(() => ssdp.close())
  ssdp.addMembership('239.255.255.250')
  ssdp.on('message', (message, remote) => {
    if (!message.toString().includes('M-SEARCH')) return
    const response = [
      'HTTP/1.1 200 OK',
      `LOCATION: http://${remote.address}:${rendererPort}/device.xml`,
      'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
      'USN: uuid:opentubex-local-test::urn:schemas-upnp-org:device:MediaRenderer:1',
      '', ''
    ].join('\r\n')
    ssdp.send(response, remote.port, remote.address)
  })

  const devices = await discoverDlnaDevices()
  const device = devices.find(item => item.name === DEVICE_NAME)
  assert.ok(device, 'the local renderer was not discovered')
  ssdp.removeAllListeners('message')
  await discoverDlnaDevices()
  const cast = await startDlnaCast(42, {
    deviceId: device.id,
    mediaUrl: `http://127.0.0.1:${upstreamPort}/video.mp4`,
    title: 'Local DLNA test',
    startSeconds: 5
  })
  assert.ok(cast.castId, JSON.stringify(cast))
  t.after(() => stopDlnaCast())

  assert.equal(mediaStatus, 206)
  assert.equal(mediaBytes, 'cdef')
  assert.deepEqual(upstreamRanges, ['bytes=2-5'])
  assert.deepEqual(actions, ['SetAVTransportURI', 'Play', 'Seek'])
  const secondCast = await startDlnaCast(99, {
    deviceId: device.id,
    mediaUrl: `http://127.0.0.1:${upstreamPort}/video.mp4`,
    title: 'Another window'
  })
  assert.match(secondCast.error ?? '', /already casting/i)
  assert.equal(await stopDlnaCast(42, cast.castId), true)
  assert.deepEqual(actions, ['SetAVTransportURI', 'Play', 'Seek', 'Stop'])

  failPlay = true
  const failedCast = await startDlnaCast(42, {
    deviceId: device.id,
    mediaUrl: `http://127.0.0.1:${upstreamPort}/video.mp4`,
    title: 'Failed Play'
  })
  assert.match(failedCast.error ?? '', /Play failed with HTTP 500/)
  assert.deepEqual(actions.slice(-3), ['SetAVTransportURI', 'Play', 'Stop'])
})
