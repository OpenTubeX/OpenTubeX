import { registerPlugin } from '@capacitor/core'
import { ensureAndroidLocalNetworkAccess } from '../androidLocalNetwork.js'
import { ChromecastSession } from '../../../chromecastSession.js'
import { FcastSession } from '../../../fcastSession.js'
import { rewriteCastDash, rewriteCastHls, MIN_RESOURCE_GRACE_MS, hlsResourceGrace, dashResourceGrace } from '../../../castManifestRewrite.js'
import { playbackScreenWake } from '../playbackScreenWake.js'

/** The native relay streams media; manifests come back here for shared rewriting. */
function createMobileCastMedia(native) {
  return ({ source, sender }) => {
    const resources = new Map()
    const ids = new Map()
    let pending = []
    let removed = []
    let nextId = 0
    let currentDashManifest
    let writing = Promise.resolve()
    let origin
    let listener
    let closed = false
    function collectExpiredResources() {
      const reachable = new Set()
      const pending = [...resources.values()].filter(resource => resource.persistent || resource.active || resource === currentDashManifest).map(resource => resource.id)
      while (pending.length) {
        const id = pending.pop()
        if (reachable.has(id)) continue
        reachable.add(id)
        for (const reference of resources.get(id)?.references ?? []) pending.push(reference)
      }
      const now = Date.now()
      for (const resource of resources.values()) {
        if (reachable.has(resource.id)) resource.expiresAt = undefined
        else {
          resource.expiresAt ??= now + resource.graceMs
          if (resource.expiresAt <= now) {
            resources.delete(resource.id)
            ids.delete(resource.key)
            removed.push(resource.id)
          }
        }
      }
    }
    const register = (value, contentType, hlsVariables, dashContext, references) => {
      const urls = Array.isArray(value) ? value : [value]
      const key = JSON.stringify([urls, contentType, hlsVariables, dashContext])
      if (!ids.has(key)) {
        if (resources.size >= 65_536) throw new Error('Too many Cast resources')
        const id = nextId++
        const candidates = urls.map(url => {
          if (/^data:/i.test(url)) return { url, suffix: 'media' }
          const parsed = new URL(url)
          if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Unsupported Cast resource URL')
          const placeholder = parsed.pathname.indexOf('$')
          const end = parsed.pathname.lastIndexOf('/', placeholder < 0 ? parsed.pathname.length : placeholder) + 1
          const template = hlsVariables === undefined && !['application/x-mpegurl', 'application/vnd.apple.mpegurl'].includes(contentType) &&
            ((dashContext === undefined && url.includes('$')) || parsed.pathname.endsWith('/'))
          return {
            url: template ? new URL(parsed.pathname.slice(0, end), parsed).href : url,
            suffix: template ? parsed.pathname.slice(end) + parsed.search : 'media',
            template
          }
        })
        const resource = { id, candidates, contentType, hlsVariables, dashContext }
        ids.set(key, id)
        resources.set(id, { ...resource, key, references: new Set(), persistent: false, active: 0, graceMs: MIN_RESOURCE_GRACE_MS })
        pending.push(resource)
      }
      const resource = resources.get(ids.get(key))
      if (references) references.add(resource.id)
      else resource.persistent = true
      return `${origin}/${sender.castId}/${resource.id}/${resource.candidates[0].suffix}`
    }
    async function flush() {
      const write = writing.then(async () => {
        // Snapshot only when this write starts: preceding failures and expiry
        // can discard registrations while a manifest waits in the queue.
        const batch = pending.filter(resource => resources.has(resource.id))
        const removeResourceIds = [...new Set(removed)]
        pending = []
        removed = []
        if (!batch.length && !removeResourceIds.length) return
        try {
          await native.registerResources({ castId: sender.castId, resources: batch, removeResourceIds })
        } catch (error) {
          // Native writes are atomic. Drop rejected additions so a permanently
          // invalid resource cannot poison later, valid manifest refreshes.
          const failedIds = new Set(batch.map(resource => resource.id))
          for (const id of failedIds) {
            const resource = resources.get(id)
            if (resource) { ids.delete(resource.key); resources.delete(id) }
          }
          for (const resource of resources.values()) {
            for (const id of resource.references) if (failedIds.has(id)) resource.references.delete(id)
          }
          removed.unshift(...removeResourceIds)
          throw error
        }
      })
      // Reject this manifest, but let the next reload register fresh resources.
      writing = write.catch(() => {})
      await write
    }
    return {
      async listen() {
        listener = await native.addListener('castManifest', async event => {
          if (event.castId !== sender.castId || closed) return
          const resource = resources.get(event.resourceId)
          if (resource) resource.active++
          try {
            if (!resource) throw new Error('Cast manifest expired')
            collectExpiredResources()
            const references = new Set()
            const registerResource = (value, type, variables, context) => register(value, type, variables, context, references)
            const dash = event.contentType === 'application/dash+xml'
            let dashAttributes
            const body = dash
              ? rewriteCastDash(event.body, event.url, registerResource, resource.dashContext, attributes => { dashAttributes = attributes })
              : rewriteCastHls(event.body, event.url, registerResource, resource.hlsVariables)
            const graceMs = dash
              ? resource.dashContext ? resource.graceMs : dashResourceGrace(dashAttributes)
              : hlsResourceGrace(event.body)
            resource.graceMs = Math.max(resource.graceMs, graceMs)
            for (const id of references) {
              const child = resources.get(id)
              child.graceMs = Math.max(child.graceMs, graceMs)
            }
            if (dash && !resource.dashContext) {
              if (currentDashManifest && currentDashManifest !== resource) currentDashManifest.references.clear()
              currentDashManifest = resource
            }
            resource.references = references
            collectExpiredResources()
            const referencedIds = [...references]
            await flush()
            if (referencedIds.some(id => !resources.has(id))) throw new Error('Cast manifest resources were discarded')
            await native.completeManifest({
              castId: sender.castId,
              requestId: event.requestId,
              body,
              ...(!dash
                ? {
                    hlsReadTimeout: /^#EXT-X-(?:TARGETDURATION|PART-INF):/m.test(event.body)
                      ? Math.min(2_147_483_647, resource.graceMs + 15_000)
                      : 0
                  }
                : {})
            })
          } catch {
            await native.completeManifest({ castId: sender.castId, requestId: event.requestId, error: true }).catch(console.error)
          } finally { if (resource) resource.active-- }
        })
        if (closed) { await listener.remove(); throw new Error('Cast relay closed') }
        const result = await native.openMedia({ castId: sender.castId, authorization: source.authorization })
        origin = result.origin
      },
      register,
      flush,
      mediaUrl: () => register(source.url, source.contentType),
      close() { closed = true; listener?.remove().catch(console.error) }
    }
  }
}

function screenWakeBlocker(screenWake) {
  const blockers = new Map()
  return {
    start() { const id = crypto.randomUUID(); blockers.set(id, screenWake.acquire()); return id },
    stop(id) { blockers.get(id)?.(); blockers.delete(id) }
  }
}

/** The renderer has one owner, so expose the shared session without owner IDs. */
function ownedSession(manager) {
  return {
    discover: () => manager.discover(),
    async start(prepare, onProgress) {
      const payload = await prepare()
      return payload ? manager.start(0, payload, undefined, undefined, undefined, onProgress) : { error: 'Cast cancelled', errorCode: 'CAST_CANCELLED' }
    },
    status: castId => manager.status(0, castId),
    control: (castId, action, value) => manager.control(0, castId, action, value),
    stop: castId => manager.stop(0, castId)
  }
}

/** Adapt the packaged Cast V2 transport to the shared desktop session logic. */
export function createMobileChromecast(native, screenWake = playbackScreenWake) {
  class Sender {
    constructor(device) {
      this.device = device
      this.castId = crypto.randomUUID()
      this.listeners = new Map()
      this.closed = false
    }

    on(event, callback) {
      if (!this.listeners.has(event)) this.listeners.set(event, [])
      this.listeners.get(event).push(callback)
    }

    emit(event, ...args) {
      for (const callback of this.listeners.get(event) ?? []) callback(...args)
    }

    async connect() {
      this.listener = await native.addListener('castEvent', event => {
        if (event.castId !== this.castId || this.closed) return
        if (event.event === 'closed') this.close()
        if (event.event === 'message') this.emit('message', event.namespace, event.payload)
      })
      if (this.closed) { await this.listener.remove(); throw new Error('Cast device disconnected') }
      const result = await native.connect({ deviceId: this.device.id, castId: this.castId })
      if (this.closed) throw Object.assign(new Error('Cast device disconnected'), { code: 'CAST_DISCONNECTED' })
      return result.address
    }

    async send(namespace, destination, payload, wait = true) {
      if (this.closed) throw new Error('Cast device disconnected')
      const result = await native.send({ castId: this.castId, namespace, destination, payload, wait })
      // Process the response before the session reads status, independently of
      // Capacitor's notification/promise delivery order.
      if (result.type) this.emit('message', namespace, result)
      return result
    }

    close() {
      if (this.closed) return
      this.closed = true
      this.listener?.remove().catch(console.error)
      native.disconnect({ castId: this.castId }).catch(console.error)
      this.emit('closed')
    }
  }

  return ownedSession(new ChromecastSession({
    discover: async () => {
      await ensureAndroidLocalNetworkAccess()
      return (await native.discover()).devices
    },
    createSender: device => new Sender(device),
    createMedia: createMobileCastMedia(native),
    randomId: () => crypto.randomUUID(),
    powerSaveBlocker: screenWakeBlocker(screenWake)
  }))
}

/** FCast shares the native Cast plugin, so its relay and foreground service apply too. */
export function createMobileFcast(native, screenWake = playbackScreenWake) {
  const disconnected = () => Object.assign(new Error('FCast receiver disconnected'), { code: 'CAST_DISCONNECTED' })
  class Connection {
    constructor(device, { onPacket, onClosed }) {
      this.device = device
      this.castId = crypto.randomUUID()
      this.closed = false
      this.onPacket = onPacket
      this.onClosed = onClosed
    }

    async open() {
      this.listener = await native.addListener('castEvent', event => {
        if (event.castId !== this.castId || this.closed) return
        if (event.event === 'closed') this.close()
        if (event.event === 'packet') this.onPacket(event.opcode, event.body)
      })
      // close() cannot remove a listener that was still being registered.
      if (this.closed) { await this.listener.remove(); throw this.closeError }
      try {
        const { address } = await native.connect({ deviceId: this.device.id, castId: this.castId, protocol: 'fcast' })
        if (this.closed) throw this.closeError
        return address
      } catch (error) {
        this.close(error)
        throw error
      }
    }

    async send(opcode, body) {
      if (this.closed) throw this.closeError
      await native.sendPacket({ castId: this.castId, opcode, ...(body === undefined ? {} : { body }) })
    }

    close(error = disconnected()) {
      if (this.closed) return
      this.closed = true
      this.closeError = error
      this.listener?.remove().catch(console.error)
      native.disconnect({ castId: this.castId }).catch(console.error)
      this.onClosed(error)
    }
  }
  return ownedSession(new FcastSession({
    discover: async () => {
      await ensureAndroidLocalNetworkAccess()
      return (await native.discover({ protocol: 'fcast' })).devices
    },
    createConnection: (device, handlers) => new Connection(device, handlers),
    createMedia: createMobileCastMedia(native),
    randomId: () => crypto.randomUUID(),
    powerSaveBlocker: screenWakeBlocker(screenWake)
  }))
}

/** @param {'chromecast' | 'fcast'} name */
const electronCast = name => ({
  discover: () => window.ftElectron[name].discover(),
  start: (prepare, onProgress) => window.ftElectron[name].start(prepare, onProgress),
  status: castId => window.ftElectron[name].status(castId),
  control: (castId, action, value) => window.ftElectron[name].control(castId, action, value),
  stop: castId => window.ftElectron[name].stop(castId)
})

const unsupportedCast = {
  discover: async () => [],
  start: async () => ({ error: 'Casting is not supported on this platform' }),
  status: async () => ({ connected: false }),
  control: async () => ({ error: 'Casting is not supported on this platform' }),
  stop: async () => ({ connected: false })
}

const androidCast = process.env.IS_CAPACITOR && !process.env.IS_IOS ? registerPlugin('Chromecast') : null

export const chromecast = androidCast
  ? createMobileChromecast(androidCast)
  : process.env.IS_ELECTRON ? electronCast('chromecast') : unsupportedCast

/** FCast needs TCP sockets, which the Electron main process or the Android plugin opens. */
export const fcast = androidCast
  ? createMobileFcast(androidCast)
  : process.env.IS_ELECTRON ? electronCast('fcast') : unsupportedCast
