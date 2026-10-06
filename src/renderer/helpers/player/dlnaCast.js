import { registerPlugin } from '@capacitor/core'
import { onBeforeUnmount, watch } from 'vue'
import { isDlnaSourceUrl } from './dlnaSource.js'
import { playbackScreenWake } from '../playbackScreenWake.js'
import { createAvTransportBody, createDlnaMetadata, formatDlnaTime, parseDlnaPosition, parseDlnaDevice, parseSsdpLocation } from '../../../dlnaProtocol.js'

function scopedAuthorization(payload) {
  const authorization = payload.authorization
  if (typeof authorization?.value !== 'string') return undefined
  try {
    const instance = new URL(authorization.url)
    const path = instance.pathname.replace(/\/+$/, '')
    if (![payload.mediaUrl, payload.audioUrl].some(raw => {
      if (!raw) return false
      const source = new URL(raw)
      return ['http:', 'https:'].includes(source.protocol) && source.origin === instance.origin &&
        (source.pathname === path || source.pathname.startsWith(`${path}/`))
    })) return undefined
    return authorization
  } catch { return undefined }
}

/** Native networking keeps multicast and streaming bytes outside the WebView. */
export function createMobileDlnaCast(native, screenWake = playbackScreenWake) {
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
    return request(device.controlUrl, 'POST', body, {
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
          (payload?.fallbackMediaUrl !== undefined && !isDlnaSourceUrl(payload.fallbackMediaUrl)) ||
          typeof payload?.title !== 'string' || payload.title.length > 500) {
        return { error: 'Device or media is unavailable' }
      }
      if (activeCast || starting || stopping) return { error: 'Another video is already casting' }
      starting = true
      let relay
      let didSetUri = false
      let source = payload
      let usedFallback = false
      const startRelay = source => {
        const authorization = scopedAuthorization(source)
        return native.startMediaServer({
          mediaUrl: source.mediaUrl,
          address: device.address,
          ...(authorization ? { authorization } : {}),
          ...(source.audioUrl ? { audioUrl: source.audioUrl, startSeconds: source.startSeconds } : {})
        })
      }
      try {
        try { relay = await startRelay(source) } catch (error) {
          if (!source.audioUrl || !source.fallbackMediaUrl) throw error
          source = { ...payload, mediaUrl: payload.fallbackMediaUrl, audioUrl: undefined }
          relay = await startRelay(source)
          usedFallback = true
        }
        const metadata = createDlnaMetadata(payload.title, relay.mediaUrl, Boolean(source.audioUrl))
        await send(device, 'SetAVTransportURI', {
          InstanceID: 0, CurrentURI: relay.mediaUrl, CurrentURIMetaData: metadata
        })
        didSetUri = true
        await send(device, 'Play', { InstanceID: 0, Speed: 1 })
        if (!source.audioUrl && Number.isFinite(payload.startSeconds) && payload.startSeconds > 0) {
          try {
            await send(device, 'Seek', { InstanceID: 0, Unit: 'REL_TIME', Target: formatDlnaTime(payload.startSeconds) })
          } catch { /* Seeking is optional on DLNA renderers. */ }
        }
        activeCast = { device, castId: relay.castId, releaseWake: screenWake?.acquire() }
        return { castId: relay.castId, deviceName: device.name, ...(usedFallback ? { usedFallback: true } : {}) }
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
      if (activeCast?.castId !== castId || payload.audioUrl) {
        return { error: 'No failed cast is available to recover' }
      }
      const status = await native.hasFailed({ castId })
      if (!status.failed || status.stopped) {
        return { error: 'No failed cast is available to recover' }
      }
      const requestedStart = Number.isFinite(payload.startSeconds) ? payload.startSeconds : 0
      const base = Number.isFinite(status.baseSeconds) && status.baseSeconds >= 0 ? status.baseSeconds : requestedStart
      let position = null
      try {
        position = parseDlnaPosition(await send(activeCast.device, 'GetPositionInfo', { InstanceID: 0 }))
      } catch { /* Some renderers do not report their playback position. */ }
      await cast.stop(castId)
      return cast.start({
        ...payload, startSeconds: position === null ? requestedStart : base + position
      })
    },

    async hasFailed(castId) {
      const result = await native.hasFailed({ castId })
      return result.failed && !result.stopped
    },

    async hasStopped(castId) {
      return Boolean((await native.hasFailed({ castId })).stopped)
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
        cast.releaseWake?.()
        stopping = false
      }
    }
  }
  return cast
}

const mobileDlna = process.env.IS_CAPACITOR ? registerPlugin('Dlna') : null

/** Keep iOS's original requests available while their source owner exists. */
export function retainIosMediaSources(getUrls) {
  if (!process.env.IS_IOS) return
  const owner = crypto.randomUUID()
  const update = urls => mobileDlna.retainMediaRequests({ owner, urls }).catch(console.error)
  const stop = watch(() => getUrls().filter(url => /^capacitor:\/\/localhost\/_opentubex_media\//.test(url)), update, { immediate: true })
  onBeforeUnmount(() => {
    stop()
    update([])
  })
}

export const dlnaCast = process.env.IS_CAPACITOR
  ? createMobileDlnaCast(mobileDlna)
  : {
      discover: () => window.ftElectron.dlna.discover(),
      start: payload => window.ftElectron.dlna.start(payload),
      stop: castId => window.ftElectron.dlna.stop(castId),
      hasFailed: castId => window.ftElectron.dlna.hasFailed(castId),
      recover: (castId, payload) => window.ftElectron.dlna.recover(castId, payload)
    }
