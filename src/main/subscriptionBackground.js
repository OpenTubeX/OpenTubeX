import { utilityProcess, net } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'

/** Owns the separate process; HTTP uses Electron's configured proxy/session. */
export function createSubscriptionBackgroundService(userDataPath) {
  const resultPath = path.join(userDataPath, 'background-subscription-results')
  let worker = null
  let sequence = 0
  let configuration = null
  let background = false
  let stopped = false
  const pending = new Map()
  const requests = new Map()

  function start() {
    if (worker || stopped) return
    const child = utilityProcess.fork(path.join(__dirname, 'subscriptionBackgroundWorker.js'), [resultPath], { serviceName: 'Subscription refresh' })
    worker = child
    child.on('message', async message => {
      if (message.type === 'abort') {
        requests.get(message.id)?.abort()
        return
      }
      if (message.type === 'fetch') {
        const controller = new AbortController()
        requests.set(message.id, controller)
        try {
          const { request } = message
          if (!['http:', 'https:'].includes(new URL(request.url).protocol)) throw new Error('Background refresh requires an HTTP URL')
          const response = await net.fetch(request.url, {
            method: request.method ?? 'GET',
            body: request.body,
            headers: { ...(request.body ? { 'Content-Type': 'application/json' } : {}), ...(request.authorization ? { Authorization: request.authorization } : {}) },
            redirect: 'error',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const chunks = []
          let size = 0
          for await (const chunk of response.body) {
            size += chunk.length
            if (size > 8 * 1024 * 1024) { controller.abort(); throw new Error('Subscription response is too large') }
            chunks.push(Buffer.from(chunk))
          }
          if (worker === child) child.postMessage({ type: 'response', id: message.id, text: Buffer.concat(chunks).toString('utf8') })
        } catch (error) {
          if (worker === child) child.postMessage({ type: 'response', id: message.id, error: error.message })
        } finally {
          requests.delete(message.id)
        }
        return
      }
      const operation = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) operation?.reject(new Error(message.error))
      else operation?.resolve(message.value)
    })
    child.once('exit', () => releaseWorker(child))
  }

  function releaseWorker(child) {
    if (worker !== child) return
    worker = null
    for (const request of requests.values()) request.abort()
    requests.clear()
    for (const operation of pending.values()) operation.reject(new Error('Background refresh process exited'))
    pending.clear()
  }

  function stopWorker() {
    const child = worker
    if (!child) return
    releaseWorker(child)
    child.kill()
  }

  function call(method, value) {
    start()
    if (!worker) return Promise.reject(new Error('Background refresh stopped'))
    return new Promise((resolve, reject) => {
      const id = ++sequence
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Background refresh process timed out')) }, 30000)
      pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value) }, reject: error => { clearTimeout(timeout); reject(error) } })
      worker.postMessage({ id, method, value })
    })
  }

  // Restart after crashes, without requiring a renderer to reconfigure the job.
  const timer = setInterval(() => {
    if (!worker && configuration?.enabled && !stopped) {
      call('configure', configuration).then(() => call('background', background && net.isOnline())).catch(error => console.error(error))
    } else if (worker && configuration?.enabled && background) {
      call('background', net.isOnline()).catch(error => console.error(error))
    }
  }, 30000)

  return {
    async configure(value) {
      configuration = value
      if (!worker && !value.enabled) return
      await call('configure', value)
      await call('background', background && value.enabled && net.isOnline())
      if (configuration === value && !value.enabled && pending.size === 0) stopWorker()
    },
    async setBackground(value) { background = value; if (worker) await call('background', value && configuration?.enabled === true && net.isOnline()) },
    completed(value) { return worker ? call('completed', value) : Promise.resolve() },
    async next() {
      if (!worker && !existsSync(resultPath)) return null
      const result = await call('next')
      // A disabled feature may still briefly need the worker to drain saved results.
      if (!configuration?.enabled && result === null && pending.size === 0) stopWorker()
      return result
    },
    acknowledge(id) { return call('acknowledge', id) },
    stop() { stopped = true; clearInterval(timer); stopWorker() }
  }
}
