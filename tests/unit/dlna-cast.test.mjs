import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { createMediaServer, parseDlnaDevice, sendAvTransport } from '../../src/main/dlnaCast.js'

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

function close(server) {
  server.closeAllConnections()
  return new Promise(resolve => server.close(resolve))
}

test('reads an AVTransport endpoint from a MediaRenderer description', () => {
  const description = `<?xml version="1.0"?>
    <root><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
      <friendlyName>Living Room &amp; TV</friendlyName><serviceList><service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <controlURL>/upnp/control</controlURL>
      </service></serviceList></device></root>`
  assert.deepEqual(parseDlnaDevice(description, 'http://192.168.1.7:8000/device.xml', '192.168.1.7'), {
    id: 'http://192.168.1.7:8000/device.xml',
    name: 'Living Room & TV',
    address: '192.168.1.7',
    controlUrl: 'http://192.168.1.7:8000/upnp/control',
    serviceType: 'urn:schemas-upnp-org:service:AVTransport:1'
  })
  assert.equal(parseDlnaDevice(description, 'http://192.168.1.7/device.xml', '192.168.1.8'), null)
  assert.equal(parseDlnaDevice(description.replace('/upnp/control', 'http://television.local:8000/upnp/control'),
    'http://192.168.1.7:8000/device.xml', '192.168.1.7').controlUrl,
  'http://192.168.1.7:8000/upnp/control')
})

test('sends escaped media metadata in a SOAP AVTransport request', async t => {
  let action
  let body
  const renderer = createServer(async (request, response) => {
    action = request.headers.soapaction
    body = await new Promise(resolve => {
      let value = ''
      request.on('data', chunk => { value += chunk })
      request.on('end', () => resolve(value))
    })
    response.writeHead(200).end()
  })
  const port = await listen(renderer)
  t.after(() => close(renderer))

  await sendAvTransport({
    controlUrl: `http://127.0.0.1:${port}/control`,
    serviceType: 'urn:schemas-upnp-org:service:AVTransport:1'
  }, 'SetAVTransportURI', {
    InstanceID: 0,
    CurrentURI: 'http://127.0.0.1/video?a=1&b=2',
    CurrentURIMetaData: '<DIDL-Lite><dc:title>A & B</dc:title></DIDL-Lite>'
  })

  assert.equal(action, '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"')
  assert.match(body, /video\?a=1&amp;b=2/)
  assert.match(body, /&lt;DIDL-Lite&gt;/)
  assert.match(body, /A &amp; B/)
})

test('serves MP4 byte ranges only to the selected device and token', async t => {
  const media = Buffer.from('abcdefghij')
  const upstream = createServer((request, response) => {
    assert.equal(request.headers.range, 'bytes=2-5')
    response.writeHead(206, {
      'content-type': 'video/mp4',
      'content-range': 'bytes 2-5/10',
      'content-length': 4,
      'accept-ranges': 'bytes'
    }).end(media.subarray(2, 6))
  })
  const upstreamPort = await listen(upstream)
  t.after(() => close(upstream))

  const proxy = createMediaServer(`http://127.0.0.1:${upstreamPort}/video`, '127.0.0.1', 'secret')
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const denied = await fetch(`http://127.0.0.1:${proxyPort}/wrong/video.mp4`)
  assert.equal(denied.status, 404)

  const response = await fetch(`http://127.0.0.1:${proxyPort}/secret/video.mp4`, {
    headers: { Range: 'bytes=2-5' }
  })
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10')
  assert.equal(await response.text(), 'cdef')
})
