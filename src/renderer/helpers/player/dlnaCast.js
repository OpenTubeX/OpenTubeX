import { registerPlugin } from '@capacitor/core'
import { isDlnaSourceUrl } from './dlnaSource.js'
import { createAvTransportBody, createDlnaMetadata, formatDlnaTime, parseDlnaDevice, parseSsdpLocation } from '../../../dlnaProtocol.js'

/** Native networking keeps multicast and streaming bytes outside the WebView. */
export function createMobileDlnaCast(native) {
  const devices = new Map()
  let activeCast = null
  let starting = false
  let stopping = false

  async function request(url, method = 'GET', body = '', headers = {}) {
    const response = await native.request({ url, method, body, headers })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`DLNA request failed with HTTP ${response.status}`)
    }
    return response.body
  }

  async function send(device, action, fields) {
    const body = createAvTransportBody(device.serviceType, action, fields)
    await request(device.controlUrl, 'POST', body, {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"${device.serviceType}#${action}"`
    })
  }

  const cast = {
    async discover() {
      const { responses } = await native.discover()
      const locations = new Map()
      for (const { message, address } of responses) {
        const location = parseSsdpLocation(message, address)
        if (location) locations.set(location, address)
      }
      const found = await Promise.all([...locations].map(async ([location, address]) => {
        try {
          const description = await request(location)
          if (description.length > 256_000) return null
          return parseDlnaDevice(description, location, address)
        } catch { return null }
      }))
      for (const device of found) {
        if (device) devices.set(device.id, device)
      }
      return found.filter(Boolean).map(({ id, name }) => ({ id, name }))
    },

    async start(payload) {
      const device = devices.get(payload?.deviceId)
      if (!device || !isDlnaSourceUrl(payload?.mediaUrl) ||
          (payload?.audioUrl !== undefined && !isDlnaSourceUrl(payload.audioUrl)) ||
          typeof payload?.title !== 'string' || payload.title.length > 500) {
        return { error: 'Device or media is unavailable' }
      }
      if (activeCast || starting || stopping) return { error: 'Another video is already casting' }
      starting = true
      let relay
      let didSetUri = false
      try {
        relay = await native.startMediaServer({
          mediaUrl: payload.mediaUrl,
          address: device.address,
          ...(payload.audioUrl ? { audioUrl: payload.audioUrl, startSeconds: payload.startSeconds } : {})
        })
        const metadata = createDlnaMetadata(payload.title, relay.mediaUrl, Boolean(payload.audioUrl))
        await send(device, 'SetAVTransportURI', {
          InstanceID: 0, CurrentURI: relay.mediaUrl, CurrentURIMetaData: metadata
        })
        didSetUri = true
        await send(device, 'Play', { InstanceID: 0, Speed: 1 })
        if (!payload.audioUrl && Number.isFinite(payload.startSeconds) && payload.startSeconds > 0) {
          try {
            await send(device, 'Seek', { InstanceID: 0, Unit: 'REL_TIME', Target: formatDlnaTime(payload.startSeconds) })
          } catch { /* Seeking is optional on DLNA renderers. */ }
        }
        activeCast = { device, castId: relay.castId }
        return { castId: relay.castId, deviceName: device.name }
      } catch (error) {
        if (didSetUri) {
          try { await send(device, 'Stop', { InstanceID: 0 }) } catch { /* Preserve the start error. */ }
        }
        if (relay) await native.stopMediaServer({ castId: relay.castId }).catch(console.error)
        return { error: error.message }
      } finally {
        starting = false
      }
    },

    async recover(castId, payload) {
      if (activeCast?.castId !== castId || payload.audioUrl || !await cast.hasFailed(castId)) {
        return { error: 'No failed cast is available to recover' }
      }
      await cast.stop(castId)
      return cast.start(payload)
    },

    async hasFailed(castId) {
      return (await native.hasFailed({ castId })).failed
    },

    async stop(castId) {
      if (!activeCast || activeCast.castId !== castId) return false
      const cast = activeCast
      activeCast = null
      stopping = true
      try {
        try { await send(cast.device, 'Stop', { InstanceID: 0 }) } catch { /* Device may be offline. */ }
        await native.stopMediaServer({ castId })
        return true
      } finally {
        stopping = false
      }
    }
  }
  return cast
}

export const dlnaCast = process.env.IS_CAPACITOR
  ? createMobileDlnaCast(registerPlugin('Dlna'))
  : {
      discover: () => window.ftElectron.dlna.discover(),
      start: payload => window.ftElectron.dlna.start(payload),
      stop: castId => window.ftElectron.dlna.stop(castId),
      hasFailed: castId => window.ftElectron.dlna.hasFailed(castId),
      recover: (castId, payload) => window.ftElectron.dlna.recover(castId, payload)
    }
