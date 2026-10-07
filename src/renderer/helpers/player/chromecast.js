import { registerPlugin } from '@capacitor/core'
import { ChromecastSession } from '../../../chromecastSession.js'
import { rewriteCastDash, rewriteCastHls } from '../../../castManifestRewrite.js'
import { playbackScreenWake } from '../playbackScreenWake.js'

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

  function createMedia({ source, sender }) {
    const resources = new Map()
    const ids = new Map()
    let pending = []
    let writing = Promise.resolve()
    let origin
    let listener
    let closed = false
    const register = (value, contentType, hlsVariables, dashContext) => {
      const urls = Array.isArray(value) ? value : [value]
      const key = JSON.stringify([urls, contentType, hlsVariables, dashContext])
      if (!ids.has(key)) {
        if (resources.size >= 65_536) throw new Error('Too many Cast resources')
        const id = resources.size
        const candidates = urls.map(url => {
          if (/^data:/i.test(url)) return { url, suffix: 'media' }
          const parsed = new URL(url)
          if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Unsupported Cast resource URL')
          const placeholder = parsed.pathname.indexOf('$')
          const end = parsed.pathname.lastIndexOf('/', placeholder < 0 ? parsed.pathname.length : placeholder) + 1
          const template = (hlsVariables === undefined && placeholder >= 0) || url.endsWith('/')
          return {
            url: template ? new URL(parsed.pathname.slice(0, end), parsed).href : url,
            suffix: template ? parsed.pathname.slice(end) + parsed.search : 'media',
            template
          }
        })
        const resource = { id, candidates, contentType, hlsVariables, dashContext }
        ids.set(key, id)
        resources.set(id, resource)
        pending.push(resource)
      }
      const resource = resources.get(ids.get(key))
      return `${origin}/${sender.castId}/${resource.id}/${resource.candidates[0].suffix}`
    }
    async function flush() {
      const batch = pending
      pending = []
      if (batch.length) writing = writing.then(() => native.registerResources({ castId: sender.castId, resources: batch }))
      await writing
    }
    return {
      async listen() {
        listener = await native.addListener('castManifest', async event => {
          if (event.castId !== sender.castId || closed) return
          try {
            const resource = resources.get(event.resourceId)
            const body = event.contentType === 'application/dash+xml'
              ? rewriteCastDash(event.body, event.url, register, resource?.dashContext)
              : rewriteCastHls(event.body, event.url, register, resource?.hlsVariables)
            await flush()
            await native.completeManifest({ castId: sender.castId, requestId: event.requestId, body })
          } catch {
            await native.completeManifest({ castId: sender.castId, requestId: event.requestId, error: true }).catch(console.error)
          }
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
  const blockers = new Map()
  const manager = new ChromecastSession({
    discover: async () => (await native.discover()).devices,
    createSender: device => new Sender(device),
    createMedia,
    randomId: () => crypto.randomUUID(),
    powerSaveBlocker: {
      start() { const id = crypto.randomUUID(); blockers.set(id, screenWake.acquire()); return id },
      stop(id) { blockers.get(id)?.(); blockers.delete(id) }
    }
  })
  return {
    discover: () => manager.discover(),
    async start(prepare) {
      const payload = await prepare()
      return payload ? manager.start(0, payload) : { error: 'Cast cancelled' }
    },
    status: castId => manager.status(0, castId),
    control: (castId, action, value) => manager.control(0, castId, action, value),
    stop: castId => manager.stop(0, castId)
  }
}

export const chromecast = process.env.IS_CAPACITOR && !process.env.IS_IOS
  ? createMobileChromecast(registerPlugin('Chromecast'))
  : {
      discover: () => window.ftElectron.chromecast.discover(),
      start: prepare => window.ftElectron.chromecast.start(prepare),
      status: castId => window.ftElectron.chromecast.status(castId),
      control: (castId, action, value) => window.ftElectron.chromecast.control(castId, action, value),
      stop: castId => window.ftElectron.chromecast.stop(castId)
    }
