import { toRaw } from 'vue'
import { sendJobValue, receiveJobValue } from './background-job-transfer.js'
import { SyncServerDataLossError } from './sync-server-errors.js'

// Remove nested Vue proxies when a bounded message cannot be structured-cloned.
function unwrapJobValue(value, seen = new WeakMap()) {
  const raw = toRaw(value)
  if (raw === null || typeof raw !== 'object') return raw
  if (!Array.isArray(raw) && Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null) return raw
  if (seen.has(raw)) return seen.get(raw)
  const result = Array.isArray(raw) ? new Array(raw.length) : {}
  seen.set(raw, result)
  for (const key of Object.keys(raw)) {
    Object.defineProperty(result, key, {
      value: unwrapJobValue(raw[key], seen), enumerable: true, configurable: true, writable: true,
    })
  }
  return result
}

export class BackgroundJobClient {
  worker = null
  nextId = 0
  requests = new Map()
  idleTimer = null

  constructor(createWorker) {
    this.createWorker = createWorker
  }

  run(operation, input) {
    clearTimeout(this.idleTimer)
    return new Promise((resolve, reject) => {
      if (!this.worker) this.start()
      const worker = this.worker
      const id = ++this.nextId
      const timer = setTimeout(() => this.fail(worker, new Error('Background processing timed out')), 120_000)
      this.requests.set(id, { resolve, reject, timer, value: undefined })
      const postMessage = message => {
        if (this.worker !== worker) throw new Error('Background processing stopped')
        try {
          worker.postMessage(message)
        } catch (error) {
          if (error.name !== 'DataCloneError') throw error
          worker.postMessage(unwrapJobValue(message))
        }
      }
      sendJobValue(postMessage, id, input).then(() => {
        postMessage({ type: 'run', id, operation })
      }).catch(error => this.fail(worker, error))
    })
  }

  start() {
    const worker = this.createWorker()
    this.worker = worker
    worker.addEventListener('message', ({ data }) => {
      const request = this.requests.get(data?.id)
      if (this.worker !== worker || !request) return
      if (data.type === 'value' || data.type === 'chunk') {
        try { receiveJobValue(request, data) } catch (error) { this.fail(worker, error) }
        return
      }
      this.requests.delete(data.id)
      clearTimeout(request.timer)
      if (data.type === 'error') {
        const error = data.error.name === 'SyncServerDataLossError'
          ? new SyncServerDataLossError(data.error.collection, data.error.deleted, data.error.previous, data.error.items)
          : new Error(data.error.message)
        error.name = data.error.name
        request.reject(error)
      } else if (data.type === 'done') request.resolve(request.value)
      else request.reject(new Error('Invalid background processing response'))
      if (this.requests.size === 0) {
        this.idleTimer = setTimeout(() => this.dispose(), 15_000)
      }
    })
    worker.addEventListener('error', () => this.fail(worker, new Error('Background processing worker failed')))
    worker.addEventListener('messageerror', () => this.fail(worker, new Error('Invalid background processing response')))
  }

  fail(worker, error) {
    if (this.worker !== worker) return
    this.dispose(error)
  }

  dispose(error = new Error('Background processing stopped')) {
    clearTimeout(this.idleTimer)
    this.worker?.terminate()
    this.worker = null
    for (const request of this.requests.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.requests.clear()
  }
}
