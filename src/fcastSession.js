import { castSourceAvailable } from './chromecastSession.js'

// v3 is the newest JSON version. Receivers that speak v4 still accept it, and
// v4 would add TLS and FlatBuffers without any feature this sender uses.
const PROTOCOL_VERSION = 3

export const FcastOpcode = Object.freeze({
  PLAY: 1,
  PAUSE: 2,
  RESUME: 3,
  STOP: 4,
  SEEK: 5,
  PLAYBACK_UPDATE: 6,
  VOLUME_UPDATE: 7,
  SET_VOLUME: 8,
  PLAYBACK_ERROR: 9,
  VERSION: 11,
  PING: 12,
  PONG: 13,
  INITIAL: 14,
  PLAY_UPDATE: 15,
  SUBSCRIBE_EVENT: 17,
  EVENT: 19
})

const IDLE = 0
const PLAYING = 1
const PAUSED = 2
const MEDIA_ITEM_END = 1

const castError = (message, code) => Object.assign(new Error(message), { code })

function mediaState(cast, connected = true) {
  return {
    connected,
    currentTime: cast.status.time,
    duration: cast.status.duration,
    paused: cast.status.state !== PLAYING,
    buffering: false,
    ended: cast.ended,
    volume: cast.muted ? cast.unmutedVolume : cast.status.volume,
    muted: cast.muted,
    activeTrackIds: []
  }
}

/**
 * One owned session prevents different windows from controlling each other.
 * Media goes through the Cast relay, so receivers never get upstream URLs or
 * credentials. `createConnection(device, { onPacket, onClosed })` returns a
 * platform transport with `open()`, `send(opcode, body)` and `close()`.
 */
export class FcastSession {
  constructor({ discover, createConnection, createMedia, randomId, powerSaveBlocker, appVersion, loadTimeoutMs = 30_000 }) {
    this.discoverDevices = discover
    this.createConnection = createConnection
    this.createMedia = createMedia
    this.randomId = randomId
    this.powerSaveBlocker = powerSaveBlocker
    this.appVersion = appVersion
    this.loadTimeoutMs = loadTimeoutMs
    this.devices = new Map()
    this.active = null
    // The last ended session, so status can report a receiver playback error.
    this.finished = null
    this.starting = false
    this.discovery = null
  }

  async discover() {
    if (!this.discovery) {
      this.discovery = this.discoverDevices().then(devices => {
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
      return { error: 'Invalid FCast receiver or media', errorCode: 'CAST_INVALID_REQUEST' }
    }
    if (this.active || this.starting) return { error: 'Another window is already casting', errorCode: 'CAST_BUSY' }
    this.starting = true
    const cast = {
      ownerId,
      castId: this.randomId(),
      device,
      connection: null,
      media: null,
      mediaUrl: null,
      version: 2,
      receiverVersion: undefined,
      status: { state: IDLE, time: payload.startSeconds, duration: 0, volume: 1 },
      loading: false,
      started: false,
      ended: false,
      muted: false,
      unmutedVolume: 1,
      error: null,
      waiters: new Set(),
      lastPacketAt: Date.now(),
      pinged: false,
      heartbeat: null,
      powerSaveBlockerId: null,
      cleaned: false
    }
    const connection = this.createConnection(device, {
      onPacket: (opcode, body) => this.handlePacket(cast, opcode, body),
      onClosed: error => {
        for (const waiter of cast.waiters) waiter.reject(error)
        this.cleanup(cast)
      }
    })
    cast.connection = connection
    cast.media = this.createMedia({ source: payload.source, deviceAddress: device.address, token: this.randomId(), getHeaders, isAllowedUrl, fetchMedia, sender: connection })
    try {
      onProgress('connecting')
      const localAddress = await connection.open()
      await connection.send(FcastOpcode.VERSION, { version: PROTOCOL_VERSION })
      // Receivers announce their version on connect; early v2 receivers may not.
      await this.waitFor(cast, () => cast.receiverVersion !== undefined, 3000)
      cast.version = Math.min(PROTOCOL_VERSION, cast.receiverVersion ?? 2)
      if (cast.version >= 3) {
        await connection.send(FcastOpcode.INITIAL, { appName: 'OpenTubeX', ...(this.appVersion ? { appVersion: this.appVersion } : {}) })
        await connection.send(FcastOpcode.SUBSCRIBE_EVENT, { event: { type: MEDIA_ITEM_END } })
      }
      await cast.media.listen(localAddress)
      cast.mediaUrl = cast.media.mediaUrl()
      await cast.media.flush?.()
      onProgress('loading')
      cast.loading = true
      await connection.send(FcastOpcode.PLAY, {
        // The Android receiver only recognizes this HLS type with its exact casing.
        container: payload.source.contentType === 'application/x-mpegurl' ? 'application/vnd.apple.mpegurl' : payload.source.contentType,
        url: cast.mediaUrl,
        // Live streams start at their live edge.
        ...(payload.isLive === true ? {} : { time: payload.startSeconds }),
        speed: payload.playbackRate,
        ...(cast.version >= 3 ? { metadata: { type: 0, title: payload.title } } : {})
      })
      // FCast has no load response: wait for the receiver to report playback.
      if (!await this.waitFor(cast, () => cast.started, this.loadTimeoutMs)) throw castError('FCast receiver did not start playback', 'CAST_TIMEOUT')
      if (payload.paused) {
        await connection.send(FcastOpcode.PAUSE)
        cast.status.state = PAUSED
      }
      if (cast.cleaned) throw castError('FCast receiver disconnected', 'CAST_DISCONNECTED')
      this.active = cast
      this.updatePowerSaveBlocker(cast)
      cast.heartbeat = setInterval(() => this.checkHeartbeat(cast), 1000)
      return { castId: cast.castId, deviceName: device.name, status: mediaState(cast) }
    } catch (error) {
      if (cast.loading && !cast.cleaned) await connection.send(FcastOpcode.STOP).catch(() => {})
      this.cleanup(cast)
      return { error: error.message, ...(error.code ? { errorCode: error.code } : {}) }
    } finally { this.starting = false }
  }

  /** Resolves once `ready` holds after a packet, or with false after `timeoutMs`. */
  waitFor(cast, ready, timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = {
        check() {
          if (cast.error) waiter.reject(castError(cast.error, 'CAST_LOAD_FAILED'))
          else if (ready()) { waiter.done(); resolve(true) }
        },
        reject(error) { waiter.done(); reject(error) },
        done() { clearTimeout(timer); cast.waiters.delete(waiter) }
      }
      const timer = setTimeout(() => { waiter.done(); resolve(false) }, timeoutMs)
      if (cast.cleaned) {
        waiter.reject(cast.error ? castError(cast.error, 'CAST_LOAD_FAILED') : castError('FCast receiver disconnected', 'CAST_DISCONNECTED'))
        return
      }
      cast.waiters.add(waiter)
      waiter.check()
    })
  }

  handlePacket(cast, opcode, body) {
    cast.lastPacketAt = Date.now()
    cast.pinged = false
    switch (opcode) {
      case FcastOpcode.VERSION:
        if (Number.isInteger(body?.version) && body.version > 0) cast.receiverVersion ??= body.version
        break
      case FcastOpcode.PING:
        cast.connection.send(FcastOpcode.PONG).catch(() => {})
        break
      case FcastOpcode.PLAYBACK_UPDATE: {
        if (![IDLE, PLAYING, PAUSED].includes(body?.state)) break
        const status = cast.status
        // Idle updates carry no position, so keep the last one for local playback.
        if (body.state !== IDLE) {
          if (Number.isFinite(body.time) && body.time >= 0) status.time = body.time
          if (Number.isFinite(body.duration) && body.duration >= 0) status.duration = body.duration
        }
        status.state = body.state
        // The Android receiver reports playing with no position or duration while it buffers.
        if (cast.loading && body.state !== IDLE && (body.duration > 0 || body.time > 0)) cast.started = true
        if (!cast.started) break
        // Receivers pause at the end; receivers without events only report this.
        const finished = status.duration > 0 && status.time >= status.duration - 0.5
        if (body.state === PAUSED && finished) cast.ended = true
        else if (body.state === IDLE && !cast.ended && !finished) this.cleanup(cast)
        break
      }
      case FcastOpcode.VOLUME_UPDATE:
        if (Number.isFinite(body?.volume)) {
          cast.status.volume = Math.min(1, Math.max(0, body.volume))
          if (cast.status.volume > 0) cast.muted = false
        }
        break
      case FcastOpcode.PLAYBACK_ERROR:
        cast.error = typeof body?.message === 'string' && body.message ? body.message.slice(0, 512) : 'FCast playback failed'
        if (this.active === cast) this.cleanup(cast)
        break
      case FcastOpcode.PLAY_UPDATE:
        // Another sender replaced this video.
        if (cast.started && typeof body?.playData?.url === 'string' && body.playData.url !== cast.mediaUrl) this.cleanup(cast)
        break
      case FcastOpcode.EVENT:
        if (cast.started && body?.event?.type === MEDIA_ITEM_END &&
          (typeof body.event.item?.url !== 'string' || body.event.item.url === cast.mediaUrl)) cast.ended = true
        break
    }
    for (const waiter of cast.waiters) waiter.check()
    if (this.active === cast) this.updatePowerSaveBlocker(cast)
  }

  checkHeartbeat(cast) {
    // Version 1 receivers have no ping; a closed socket still ends the session.
    if (cast.version < 2) return
    const idle = Date.now() - cast.lastPacketAt
    if (idle >= 9000) this.cleanup(cast)
    else if (idle >= 3000 && !cast.pinged) {
      cast.pinged = true
      cast.connection.send(FcastOpcode.PING).catch(() => this.cleanup(cast))
    }
  }

  updatePowerSaveBlocker(cast) {
    if (cast.status.state === PLAYING) {
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
    if (this.active === cast) {
      this.active = null
      this.finished = cast
    }
    if (cast.cleaned) return
    cast.cleaned = true
    clearInterval(cast.heartbeat)
    cast.media.close()
    cast.connection.close()
  }

  status(ownerId, castId) {
    const cast = this.owned(ownerId, castId)
    if (cast) return mediaState(cast)
    const finished = this.finished
    return finished?.ownerId === ownerId && finished.castId === castId && finished.error
      ? { connected: false, error: finished.error, errorCode: 'CAST_LOAD_FAILED' }
      : { connected: false }
  }

  async control(ownerId, castId, action, value) {
    const cast = this.owned(ownerId, castId)
    if (!cast) return { error: 'FCast session is unavailable', errorCode: 'CAST_DISCONNECTED' }
    const { connection, status } = cast
    try {
      switch (action) {
        case 'play':
          await connection.send(FcastOpcode.RESUME)
          status.state = PLAYING
          break
        case 'pause':
          await connection.send(FcastOpcode.PAUSE)
          status.state = PAUSED
          break
        case 'seek':
          if (!Number.isFinite(value) || value < 0) return { error: 'Invalid FCast seek position', errorCode: 'CAST_INVALID_REQUEST' }
          await connection.send(FcastOpcode.SEEK, { time: value })
          status.time = value
          cast.ended = false
          break
        case 'volume':
          if (!Number.isFinite(value) || value < 0 || value > 1) return { error: 'Invalid FCast volume', errorCode: 'CAST_INVALID_REQUEST' }
          await connection.send(FcastOpcode.SET_VOLUME, { volume: value })
          status.volume = value
          cast.muted = false
          break
        case 'mute':
          // FCast has no mute, so restore the previous volume afterwards.
          if (typeof value !== 'boolean') return { error: 'Invalid FCast mute state', errorCode: 'CAST_INVALID_REQUEST' }
          if (value === cast.muted) break
          if (value) cast.unmutedVolume = status.volume
          await connection.send(FcastOpcode.SET_VOLUME, { volume: value ? 0 : cast.unmutedVolume })
          status.volume = value ? 0 : cast.unmutedVolume
          cast.muted = value
          break
        default:
          return { error: 'Unsupported FCast control', errorCode: 'CAST_INVALID_REQUEST' }
      }
    } catch (error) { return { error: error.message, ...(error.code ? { errorCode: error.code } : {}) } }
    if (this.active !== cast) return { error: 'FCast session is unavailable', errorCode: 'CAST_DISCONNECTED' }
    this.updatePowerSaveBlocker(cast)
    return mediaState(cast)
  }

  async stop(ownerId, castId) {
    const cast = ownerId === undefined ? this.active : this.owned(ownerId, castId)
    if (!cast) return { connected: false }
    const state = mediaState(cast, false)
    try {
      await cast.connection.send(FcastOpcode.STOP)
    } catch { /* The receiver may already have disconnected. */ } finally { this.cleanup(cast) }
    return state
  }
}
