import { createSocket } from 'node:dgram'
import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import sax from 'sax'

const SSDP_ADDRESS = '239.255.255.250'
const DISCOVERY_TIME_MS = 2500

/** @type {Map<string, { id: string, name: string, address: string, controlUrl: string, serviceType: string }>} */
const discoveredDevices = new Map()

/** @type {{ ownerId: number, castId: string, device: object, server: import('node:http').Server } | null} */
let activeCast = null
let startingCast = false

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

/**
 * @param {string} description
 * @param {string} location
 * @param {string} address
 */
export function parseDlnaDevice(description, location, address) {
  const parser = sax.parser(true, { trim: true })
  const stack = []
  let name = ''
  let isRenderer = false
  let service = null
  let transport = null

  parser.onopentag = tag => {
    const element = { name: tag.name.split(':').at(-1), text: '' }
    stack.push(element)
    if (element.name === 'service') service = {}
  }
  parser.ontext = text => { if (stack.length > 0) stack.at(-1).text += text }
  parser.oncdata = text => { if (stack.length > 0) stack.at(-1).text += text }
  parser.onclosetag = () => {
    const element = stack.pop()
    if (element.name === 'friendlyName' && !name) name = element.text.trim()
    if (element.name === 'deviceType' && /:device:MediaRenderer:\d+$/.test(element.text.trim())) isRenderer = true
    if (service && element.name === 'serviceType') service.type = element.text.trim()
    if (service && element.name === 'controlURL') service.controlUrl = element.text.trim()
    if (element.name === 'service') {
      if (service?.type?.startsWith('urn:schemas-upnp-org:service:AVTransport:') && service.controlUrl) {
        transport = service
      }
      service = null
    }
  }

  try {
    parser.write(description).close()
    if (!isRenderer || !transport || !name) return null
    const control = new URL(transport.controlUrl, location)
    if (control.protocol !== 'http:' || (isIP(control.hostname) && control.hostname !== address)) return null
    control.hostname = address
    return {
      id: location,
      name,
      address,
      controlUrl: control.href,
      serviceType: transport.type
    }
  } catch {
    return null
  }
}

function parseSsdpLocation(message, address) {
  const header = /^location:\s*(\S+)/im.exec(message)
  if (!header) return null
  try {
    const url = new URL(header[1])
    if (url.protocol !== 'http:' || (isIP(url.hostname) && url.hostname !== address)) return null
    url.hostname = address
    return url.href
  } catch {
    return null
  }
}

export async function discoverDlnaDevices() {
  const locations = new Map()
  const socket = createSocket('udp4')
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(0, () => {
        socket.removeListener('error', reject)
        resolve()
      })
    })
    socket.on('message', (message, remote) => {
      const location = parseSsdpLocation(message.toString(), remote.address)
      if (location) locations.set(location, remote.address)
    })
    const request = [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_ADDRESS}:1900`,
      'MAN: "ssdp:discover"',
      'MX: 2',
      'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
      '', ''
    ].join('\r\n')
    await new Promise((resolve, reject) => {
      socket.send(request, 1900, SSDP_ADDRESS, error => error ? reject(error) : resolve())
    })
    await new Promise(resolve => setTimeout(resolve, DISCOVERY_TIME_MS))
  } finally {
    socket.close()
  }

  const devices = await Promise.all([...locations].map(async ([location, address]) => {
    try {
      const response = await fetch(location, { signal: AbortSignal.timeout(3000), redirect: 'error' })
      if (!response.ok || Number(response.headers.get('content-length')) > 256_000) return null
      const description = await response.text()
      if (description.length > 256_000) return null
      return parseDlnaDevice(description, location, address)
    } catch {
      return null
    }
  }))
  discoveredDevices.clear()
  for (const device of devices) {
    if (device) discoveredDevices.set(device.id, device)
  }
  return [...discoveredDevices.values()].map(({ id, name }) => ({ id, name }))
}

export async function sendAvTransport(device, action, fields) {
  const argumentsXml = Object.entries(fields)
    .map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`).join('')
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${device.serviceType}">${argumentsXml}</u:${action}></s:Body></s:Envelope>`
  const response = await fetch(device.controlUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"${device.serviceType}#${action}"`
    },
    body
  })
  if (!response.ok) throw new Error(`${action} failed with HTTP ${response.status}`)
}

function chooseLocalAddress(remoteAddress) {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    socket.once('error', error => { socket.close(); reject(error) })
    socket.connect(1900, remoteAddress, () => {
      const address = socket.address().address
      socket.close()
      resolve(address)
    })
  })
}

export function createMediaServer(mediaUrl, deviceAddress, token, upstreamHeaders = {}) {
  return createServer(async (request, response) => {
    if (
      request.url !== `/${token}/video.mp4` ||
      !['GET', 'HEAD'].includes(request.method) ||
      request.socket.remoteAddress?.replace(/^::ffff:/, '') !== deviceAddress
    ) {
      response.writeHead(404).end()
      return
    }
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      const upstream = await fetch(mediaUrl, {
        method: request.method,
        headers: { ...upstreamHeaders, ...(request.headers.range ? { Range: request.headers.range } : {}) },
        signal: controller.signal,
        redirect: 'error'
      }).finally(() => clearTimeout(timeout))
      const headers = { 'content-type': 'video/mp4', 'transfermode.dlna.org': 'Streaming' }
      for (const name of ['content-length', 'content-range', 'accept-ranges']) {
        const value = upstream.headers.get(name)
        if (value) headers[name] = value
      }
      response.writeHead(upstream.status, headers)
      if (request.method === 'HEAD' || !upstream.body) {
        await upstream.body?.cancel()
        response.end()
        return
      }
      const stream = Readable.fromWeb(upstream.body)
      response.on('close', () => stream.destroy())
      stream.on('error', () => response.destroy()).pipe(response)
    } catch {
      if (!response.headersSent) response.writeHead(502).end()
      else response.destroy()
    }
  })
}

function formatTime(seconds) {
  const value = Math.floor(Math.max(0, seconds))
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60]
    .map(part => String(part).padStart(2, '0')).join(':')
}

/**
 * @param {number} ownerId
 * @param {{ deviceId: string, mediaUrl: string, title: string, startSeconds?: number }} payload
 */
export async function startDlnaCast(ownerId, payload, upstreamHeaders = {}) {
  const device = discoveredDevices.get(payload?.deviceId)
  let url
  try { url = new URL(payload?.mediaUrl) } catch { return { error: 'Invalid media URL' } }
  if (!device || !['http:', 'https:'].includes(url.protocol) || !isIP(device.address)) {
    return { error: 'Device or media URL is unavailable' }
  }
  if (typeof payload.title !== 'string' || payload.title.length > 500) {
    return { error: 'Invalid video title' }
  }
  if (activeCast || startingCast) return { error: 'Another window is already casting' }
  startingCast = true

  const token = randomBytes(24).toString('hex')
  const server = createMediaServer(url.href, device.address, token, upstreamHeaders)
  try {
    const localAddress = await chooseLocalAddress(device.address)
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, localAddress, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    const mediaAddress = `http://${localAddress}:${server.address().port}/${token}/video.mp4`
    const metadata = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1"><dc:title>${escapeXml(payload.title)}</dc:title><upnp:class>object.item.videoItem</upnp:class><res protocolInfo="http-get:*:video/mp4:DLNA.ORG_OP=01">${escapeXml(mediaAddress)}</res></item></DIDL-Lite>`
    await sendAvTransport(device, 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: mediaAddress,
      CurrentURIMetaData: metadata
    })
    await sendAvTransport(device, 'Play', { InstanceID: 0, Speed: 1 })
    const castId = randomBytes(16).toString('hex')
    activeCast = { ownerId, castId, device, server }
    if (Number.isFinite(payload.startSeconds) && payload.startSeconds > 0) {
      try {
        await sendAvTransport(device, 'Seek', {
          InstanceID: 0,
          Unit: 'REL_TIME',
          Target: formatTime(payload.startSeconds)
        })
      } catch { /* Some renderers do not support seeking. */ }
    }
    return { castId, deviceName: device.name }
  } catch (error) {
    if (server.listening) server.close()
    return { error: error.message }
  } finally {
    startingCast = false
  }
}

export async function stopDlnaCast(ownerId, castId) {
  if (!activeCast || (ownerId !== undefined && (
    activeCast.ownerId !== ownerId || (castId !== undefined && activeCast.castId !== castId)
  ))) return false
  const cast = activeCast
  activeCast = null
  cast.server.close()
  cast.server.closeAllConnections()
  try {
    await sendAvTransport(cast.device, 'Stop', { InstanceID: 0 })
  } catch { /* The renderer may already have disconnected. */ }
  return true
}
