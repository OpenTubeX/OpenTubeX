export class PlayerScriptEvaluator {
  /** @type {Worker | null} */
  worker = null
  nextId = 0
  /** @type {Map<number, {code: string, retried: boolean, resolve: (value: unknown) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout>}>} */
  requests = new Map()

  /** @param {() => Worker} createWorker */
  constructor(createWorker) {
    this.createWorker = createWorker
  }

  /**
   * @param {string} code
   * @returns {Promise<unknown>}
   */
  evaluate(code) {
    return new Promise((resolve, reject) => {
      if (typeof code !== 'string') throw new TypeError('Player code must be a string')
      // Bound source before structured cloning allocates another host copy.
      if (code.length > 4 * 1024 * 1024) throw new Error('Player code is too large')
      if (!this.worker) this.startWorker()
      const worker = this.worker
      const id = ++this.nextId
      const timer = setTimeout(() => this.fail(worker, new Error('Player-script evaluation timed out')), 30_000)
      this.requests.set(id, { code, retried: false, resolve, reject, timer })
      try {
        worker.postMessage({ id, code })
      } catch (error) {
        this.fail(worker, new Error(String(error)))
      }
    })
  }

  /** Start a worker and connect responses to pending evaluations. */
  startWorker() {
    const worker = this.createWorker()
    this.worker = worker
    worker.addEventListener('message', ({ data }) => {
      const request = this.requests.get(data?.id)
      if (worker !== this.worker || !request) return
      if (typeof data.error === 'string' && data.error.includes('Assertion failed: list_empty(&rt->gc_obj_list)')) {
        this.retryAfterRuntimeAbort(worker, new Error(data.error))
        return
      }
      this.requests.delete(data.id)
      clearTimeout(request.timer)
      if (typeof data.error === 'string') request.reject(new Error(data.error))
      else request.resolve(data.result)
    })
    worker.addEventListener('error', () => this.fail(worker, new Error('The player-script worker failed')))
    worker.addEventListener('messageerror', () => this.fail(worker, new Error('Invalid player-script worker response')))
  }

  /**
   * Retry pending scripts once after QuickJS aborts its WASM module.
   * @param {Worker} worker
   * @param {Error} error
   */
  retryAfterRuntimeAbort(worker, error) {
    if ([...this.requests.values()].some(request => request.retried)) {
      this.fail(worker, error)
      return
    }
    worker.terminate()
    this.worker = null
    try {
      this.startWorker()
    } catch (startError) {
      for (const request of this.requests.values()) {
        clearTimeout(request.timer)
        request.reject(new Error(String(startError)))
      }
      this.requests.clear()
      return
    }
    for (const [id, request] of this.requests) {
      request.retried = true
      clearTimeout(request.timer)
      const replacement = this.worker
      request.timer = setTimeout(() => this.fail(replacement, new Error('Player-script evaluation timed out')), 30_000)
      try {
        this.worker.postMessage({ id, code: request.code })
      } catch (postError) {
        this.fail(this.worker, new Error(String(postError)))
        break
      }
    }
  }

  /**
   * @param {Worker} worker
   * @param {Error} error
   */
  fail(worker, error) {
    if (worker !== this.worker) return
    worker.terminate()
    this.worker = null
    for (const request of this.requests.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.requests.clear()
  }
}
