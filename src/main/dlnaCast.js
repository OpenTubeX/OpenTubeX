import { createSocket } from 'node:dgram'
import { isIP } from 'node:net'
import { randomBytes } from 'node:crypto'
import { createMediaServer } from './dlnaMediaServer.js'
import { createMuxedMediaServer } from './dlnaMux.js'
import { createAvTransportBody, createDlnaMetadata, formatDlnaTime, parseDlnaPosition, parseDlnaDevice, parseSsdpLocation } from '../dlnaProtocol.js'

export { createMediaServer } from './dlnaMediaServer.js'
export { parseDlnaDevice } from '../dlnaProtocol.js'

const SSDP_ADDRESS = '239.255.255.250'
const DISCOVERY_TIME_MS = 2500

/** @type {Map<string, { id: string, name: string, address: string, controlUrl: string, serviceType: string }>} */
const discoveredDevices = new Map()

/** @type {{ ownerId: number, castId: string, device: object, server: import('node:http').Server } | null} */
let activeCast = null
let startingCast = false

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
  for (const device of devices) {
    if (device) discoveredDevices.set(device.id, device)
  }
  return devices.filter(Boolean).map(({ id, name }) => ({ id, name }))
}

export async function sendAvTransport(device, action, fields) {
  const body = createAvTransportBody(device.serviceType, action, fields)
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
  if (action === 'GetPositionInfo') {
    if (Number(response.headers.get('content-length')) > 256_000) throw new Error('DLNA response is too large')
    const text = await response.text()
    if (text.length > 256_000) throw new Error('DLNA response is too large')
    return text
  }
  await response.body?.cancel()
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

/**
 * @param {number} ownerId
 * @param {{ deviceId: string, mediaUrl: string, title: string, audioUrl?: string, startSeconds?: number }} payload
 */
export async function startDlnaCast(ownerId, payload, upstreamHeaders = {}, muxOptions = {}) {
  const device = discoveredDevices.get(payload?.deviceId)
  let url
  try { url = new URL(payload?.mediaUrl) } catch { return { error: 'Invalid media URL' } }
  if (!device || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !isIP(device.address)) {
    return { error: 'Device or media URL is unavailable' }
  }
  if (typeof payload.title !== 'string' || payload.title.length > 500) {
    return { error: 'Invalid video title' }
  }
  if (payload.audioUrl !== undefined) {
    try {
      const audio = new URL(payload.audioUrl)
      if (!['http:', 'https:'].includes(audio.protocol) || audio.username || audio.password ||
          typeof muxOptions.ffmpegPath !== 'string') return { error: 'Invalid audio source or FFmpeg is unavailable' }
    } catch { return { error: 'Invalid audio source' } }
  }
  if (activeCast || startingCast) return { error: 'Another window is already casting' }
  startingCast = true

  const token = randomBytes(24).toString('hex')
  let server
  let didSetUri = false
  try {
    const localAddress = await chooseLocalAddress(device.address)
    server = payload.audioUrl
      ? await createMuxedMediaServer(url.href, payload.audioUrl, device.address, token, {
          ...muxOptions,
          videoHeaders: upstreamHeaders,
          startSeconds: Number.isFinite(payload.startSeconds) ? Math.max(0, payload.startSeconds) : 0
        })
      : createMediaServer(url.href, device.address, token, upstreamHeaders)
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, localAddress, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    const mediaAddress = `http://${localAddress}:${server.address().port}/${token}/video.mp4`
    const metadata = createDlnaMetadata(payload.title, mediaAddress, Boolean(payload.audioUrl))
    await sendAvTransport(device, 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: mediaAddress,
      CurrentURIMetaData: metadata
    })
    didSetUri = true
    await sendAvTransport(device, 'Play', { InstanceID: 0, Speed: 1 })
    const castId = randomBytes(16).toString('hex')
    activeCast = { ownerId, castId, device, server }
    if (!payload.audioUrl && Number.isFinite(payload.startSeconds) && payload.startSeconds > 0) {
      try {
        await sendAvTransport(device, 'Seek', {
          InstanceID: 0,
          Unit: 'REL_TIME',
          Target: formatDlnaTime(payload.startSeconds)
        })
      } catch { /* Some renderers do not support seeking. */ }
    }
    return { castId, deviceName: device.name }
  } catch (error) {
    if (didSetUri) {
      try { await sendAvTransport(device, 'Stop', { InstanceID: 0 }) } catch { /* Preserve the startup error. */ }
    }
    if (server) {
      server.closeAllConnections()
      server.close()
    }
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

export function hasDlnaCastFailed(ownerId, castId) {
  return activeCast?.ownerId === ownerId && activeCast.castId === castId && Boolean(activeCast.server.muxFailed)
}

export async function getDlnaCastPosition(ownerId, castId) {
  if (activeCast?.ownerId !== ownerId || activeCast.castId !== castId) return null
  try {
    return parseDlnaPosition(await sendAvTransport(activeCast.device, 'GetPositionInfo', { InstanceID: 0 }))
  } catch { return null }
}
