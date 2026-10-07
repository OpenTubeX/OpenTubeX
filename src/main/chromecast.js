import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { CastSender, discoverCastDevices, CAST_CONNECTION, CAST_RECEIVER, CAST_MEDIA } from './castSender.js'
import { createCastMediaServer, MAX_CAST_SUBTITLE_BYTES } from './castMediaServer.js'
import { getInlineCastManifestType } from '../castManifest.js'

const RECEIVER_APP = 'CC1AD845' // Default Media Receiver, independent of YouTube.
const CONTENT_TYPES = new Set(['video/mp4', 'application/dash+xml', 'application/x-mpegurl', 'application/vnd.apple.mpegurl'])

export function castSourceAvailable(source) {
  if (!source || !CONTENT_TYPES.has(source.contentType) || typeof source.url !== 'string' || source.url.length > 6_000_000) return false
  const inlineType = getInlineCastManifestType(source.url)
  if (inlineType) return source.contentType === inlineType
  try {
    const url = new URL(source.url)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
}

function mediaState(status) {
  return {
    connected: true,
    currentTime: Number.isFinite(status.currentTime) ? status.currentTime : 0,
    duration: Number.isFinite(status.media?.duration) ? status.media.duration : 0,
    paused: status.playerState === 'PAUSED' || status.playerState === 'IDLE',
    buffering: status.playerState === 'BUFFERING',
    ended: status.playerState === 'IDLE' && status.idleReason === 'FINISHED',
    volume: status.volume?.level ?? 1,
    muted: status.volume?.muted ?? false,
    activeTrackIds: status.activeTrackIds ?? []
  }
}

/** One owned session prevents different windows from controlling each other. */
export class ChromecastManager {
  constructor(executable, powerSaveBlocker) {
    this.executable = executable
    this.powerSaveBlocker = powerSaveBlocker
    this.devices = new Map()
    this.active = null
    this.starting = false
    this.discovery = null
  }

  async discover() {
    if (!this.discovery) {
      this.discovery = discoverCastDevices(this.executable).then(devices => {
        this.devices = new Map(devices.map(device => [device.id, device]))
        return devices.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
      }).finally(() => { this.discovery = null })
    }
    return this.discovery
  }

  owned(ownerId, castId) {
    return this.active && this.active.ownerId === ownerId && this.active.castId === castId ? this.active : null
  }

  async start(ownerId, payload, getHeaders, isAllowedUrl, fetchMedia, onProgress = () => {}) {
    const device = this.devices.get(payload?.deviceId)
    if (!device || !castSourceAvailable(payload?.source) || typeof payload.title !== 'string' || payload.title.length > 500 ||
      !Number.isFinite(payload.startSeconds) || payload.startSeconds < 0 || typeof payload.paused !== 'boolean' ||
      !Number.isFinite(payload.playbackRate) || payload.playbackRate <= 0) {
      return { error: 'Invalid Cast device or media' }
    }
    if (this.active || this.starting) return { error: 'Another window is already casting' }
    const captions = payload.captions ?? []
    if (!Array.isArray(captions) || captions.length > 100 || captions.some(caption =>
      typeof caption.url !== 'string' || !(
        (/^https?:\/\//i.test(caption.url) && caption.url.length <= 16_000) ||
        (/^data:text\/vtt;charset=utf-8,/i.test(caption.url) && caption.url.length <= MAX_CAST_SUBTITLE_BYTES * 3 + 64)) ||
      typeof caption.label !== 'string' || caption.label.length > 256 || typeof caption.language !== 'string' || caption.language.length > 32)) {
      return { error: 'Invalid Cast subtitles' }
    }
    this.starting = true
    const sender = new CastSender(this.executable, device)
    const media = createCastMediaServer(payload.source, device.address, randomBytes(24).toString('hex'), getHeaders, isAllowedUrl, fetchMedia)
    const cast = {
      ownerId,
      castId: randomBytes(16).toString('hex'),
      device,
      sender,
      media,
      transportId: null,
      receiverSessionId: null,
      mediaSessionId: null,
      trackCount: captions.length,
      status: {},
      powerSaveBlockerId: null,
      heartbeat: null
    }
    sender.on('closed', () => this.cleanup(cast))
    sender.on('message', (namespace, message) => {
      if (namespace === CAST_CONNECTION && message.type === 'CLOSE') {
        this.cleanup(cast)
        return
      }
      if (namespace === CAST_RECEIVER && message.type === 'RECEIVER_STATUS' && message.status?.volume) {
        cast.status.volume = message.status.volume
      }
      if (namespace !== CAST_MEDIA || message.type !== 'MEDIA_STATUS') return
      const status = message.status?.[0]
      if (!status) {
        if (cast.mediaSessionId !== null) this.cleanup(cast)
        return
      }
      if (cast.mediaSessionId !== null && (status.mediaSessionId !== cast.mediaSessionId ||
        (status.media?.contentId && status.media.contentId !== cast.mediaUrl))) {
        this.cleanup(cast)
        return
      }
      cast.status = { ...cast.status, ...status, volume: cast.status.volume, media: { ...cast.status.media, ...status.media } }
      if (this.active === cast) this.updatePowerSaveBlocker(cast)
    })
    let loaded = false
    try {
      onProgress('connecting')
      const localAddress = await sender.connect()
      if (isIP(localAddress) !== 4) throw new Error('Cast requires an IPv4 network interface')
      await new Promise((resolve, reject) => {
        media.server.once('error', reject)
        media.server.listen(0, localAddress, () => { media.server.removeListener('error', reject); resolve() })
      })
      media.setOrigin(`http://${localAddress}:${media.server.address().port}`)
      cast.mediaUrl = media.mediaUrl()
      const tracks = captions.map((caption, index) => ({
        trackId: index + 1,
        type: 'TEXT',
        subtype: 'SUBTITLES',
        trackContentId: media.register(caption.url, 'text/vtt'),
        trackContentType: 'text/vtt',
        name: caption.label,
        language: caption.language
      }))
      await sender.send(CAST_CONNECTION, 'receiver-0', { type: 'CONNECT' }, false)
      onProgress('launching')
      let receiver = await sender.send(CAST_RECEIVER, 'receiver-0', { type: 'GET_STATUS' })
      let application = receiver.status?.applications?.find(app => app.appId === RECEIVER_APP)
      if (!application) {
        receiver = await sender.send(CAST_RECEIVER, 'receiver-0', { type: 'LAUNCH', appId: RECEIVER_APP })
        application = receiver.status?.applications?.find(app => app.appId === RECEIVER_APP)
      }
      if (!application?.transportId || !application.sessionId) throw new Error('Cast receiver could not launch')
      cast.transportId = application.transportId
      cast.receiverSessionId = application.sessionId
      await sender.send(CAST_CONNECTION, cast.transportId, { type: 'CONNECT' }, false)
      const activeTrackIds = Number.isInteger(payload.captionIndex) && tracks[payload.captionIndex]
        ? [payload.captionIndex + 1]
        : []
      onProgress('loading')
      const result = await sender.send(CAST_MEDIA, cast.transportId, {
        type: 'LOAD',
        currentTime: payload.startSeconds,
        playbackRate: payload.playbackRate,
        autoplay: !payload.paused,
        activeTrackIds,
        media: {
          contentId: cast.mediaUrl,
          contentType: payload.source.contentType,
          streamType: payload.isLive === true ? 'LIVE' : 'BUFFERED',
          metadata: { metadataType: 0, title: payload.title },
          tracks
        }
      })
      loaded = true
      const status = result.status?.[0]
      if (!Number.isInteger(status?.mediaSessionId) || status.playerState === 'IDLE') throw new Error('Cast media failed to load')
      if (sender.closed) throw new Error('Cast device disconnected')
      cast.mediaSessionId = status.mediaSessionId
      cast.status = { ...cast.status, ...status, volume: cast.status.volume }
      this.active = cast
      this.updatePowerSaveBlocker(cast)
      cast.heartbeat = setInterval(() => {
        sender.send('urn:x-cast:com.google.cast.tp.heartbeat', 'receiver-0', { type: 'PING' }, false).catch(() => this.cleanup(cast))
        sender.send(CAST_RECEIVER, 'receiver-0', { type: 'GET_STATUS' }).then(result => {
          if (!result.status?.applications?.some(app => app.sessionId === cast.receiverSessionId)) this.cleanup(cast)
        }).catch(() => this.cleanup(cast))
      }, 5000)
      return { castId: cast.castId, deviceName: device.name, status: mediaState(cast.status) }
    } catch (error) {
      if (loaded && cast.transportId) {
        try { await sender.send(CAST_MEDIA, cast.transportId, { type: 'STOP', mediaSessionId: cast.status.mediaSessionId }) } catch { /* Preserve startup failure. */ }
      }
      this.cleanup(cast)
      return { error: error.message }
    } finally { this.starting = false }
  }

  updatePowerSaveBlocker(cast) {
    if (['PLAYING', 'BUFFERING'].includes(cast.status.playerState)) {
      if (cast.powerSaveBlockerId === null) cast.powerSaveBlockerId = this.powerSaveBlocker?.start('prevent-app-suspension') ?? null
    } else this.releasePowerSaveBlocker(cast)
  }

  releasePowerSaveBlocker(cast) {
    if (cast.powerSaveBlockerId === null) return
    const id = cast.powerSaveBlockerId
    cast.powerSaveBlockerId = null
    this.powerSaveBlocker.stop(id)
  }

  cleanup(cast) {
    this.releasePowerSaveBlocker(cast)
    if (this.active === cast) this.active = null
    clearInterval(cast.heartbeat)
    cast.media.server.close()
    cast.media.server.closeAllConnections()
    cast.sender.close()
  }

  async status(ownerId, castId) {
    const cast = this.owned(ownerId, castId)
    if (!cast) return { connected: false }
    try {
      await cast.sender.send(CAST_MEDIA, cast.transportId, { type: 'GET_STATUS' })
      if (cast.status.playerState === 'IDLE' && cast.status.idleReason !== 'FINISHED') this.cleanup(cast)
      if (this.active !== cast) return { ...mediaState(cast.status), connected: false }
      return mediaState(cast.status)
    } catch {
      this.cleanup(cast)
      return { ...mediaState(cast.status), connected: false }
    }
  }

  async control(ownerId, castId, action, value) {
    const cast = this.owned(ownerId, castId)
    if (!cast) return { error: 'Cast session is unavailable' }
    let payload = { mediaSessionId: cast.mediaSessionId }
    switch (action) {
      case 'play': payload.type = 'PLAY'; break
      case 'pause': payload.type = 'PAUSE'; break
      case 'seek':
        if (!Number.isFinite(value) || value < 0) return { error: 'Invalid Cast seek position' }
        payload = { ...payload, type: 'SEEK', currentTime: value, resumeState: cast.status.playerState === 'PAUSED' ? 'PLAYBACK_PAUSE' : 'PLAYBACK_START' }
        break
      case 'volume':
        if (!Number.isFinite(value) || value < 0 || value > 1) return { error: 'Invalid Cast volume' }
        payload = { ...payload, type: 'SET_VOLUME', volume: { level: value } }
        break
      case 'mute':
        if (typeof value !== 'boolean') return { error: 'Invalid Cast mute state' }
        payload = { ...payload, type: 'SET_VOLUME', volume: { muted: value } }
        break
      case 'caption':
        if (!Number.isInteger(value) || value < 0 || value > cast.trackCount) return { error: 'Invalid Cast subtitle track' }
        payload = { ...payload, type: 'EDIT_TRACKS_INFO', activeTrackIds: value === 0 ? [] : [value] }
        break
      default: return { error: 'Unsupported Cast control' }
    }
    try {
      if (action === 'volume' || action === 'mute') {
        await cast.sender.send(CAST_RECEIVER, 'receiver-0', { type: 'SET_VOLUME', volume: payload.volume })
      } else {
        await cast.sender.send(CAST_MEDIA, cast.transportId, payload)
      }
      if (this.active !== cast) return { error: 'Cast session is unavailable' }
      return mediaState(cast.status)
    } catch (error) { return { error: error.message } }
  }

  async stop(ownerId, castId) {
    const cast = ownerId === undefined ? this.active : this.owned(ownerId, castId)
    if (!cast) return { connected: false }
    let state = mediaState(cast.status)
    try {
      // A failed status request goes straight to cleanup instead of waiting
      // through another response timeout from the same unresponsive receiver.
      await cast.sender.send(CAST_MEDIA, cast.transportId, { type: 'GET_STATUS' })
      state = mediaState(cast.status)
      if (this.active === cast) await cast.sender.send(CAST_MEDIA, cast.transportId, { type: 'STOP', mediaSessionId: cast.mediaSessionId })
    } catch { /* Preserve the last known position when disconnected or unresponsive. */ } finally { this.cleanup(cast) }
    return { ...state, connected: false }
  }
}
