/** Keeps large SABR conversions off the renderer thread, scoped to one owner. */
export function createAndroidSegmentEncoder(createWorker = () => new Worker(
  new URL('./androidSegmentEncoder.worker.js', import.meta.url), { name: 'android-segment-encoder' }
)) {
  const worker = createWorker()
  const pending = new Map()
  let sequence = 0
  let closed = false

  function close(error = new Error('Playback was replaced')) {
    if (closed) return
    closed = true
    worker.terminate()
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }

  worker.addEventListener('message', ({ data }) => {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    clearTimeout(request.timer)
    if (data.error) request.reject(new Error(data.error))
    else request.resolve(data.data)
  })
  worker.addEventListener('error', () => close(new Error('SABR encoding worker failed')))
  worker.addEventListener('messageerror', () => close(new Error('Invalid SABR encoding response')))

  return {
    encode(bytes) {
      return new Promise((resolve, reject) => {
        if (closed) throw new Error('Playback was replaced')
        if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('SABR segment exceeds the size limit')
        const id = ++sequence
        const timer = setTimeout(() => close(new Error('SABR encoding timed out')), 30_000)
        pending.set(id, { resolve, reject, timer })
        try {
          // Source bytes may belong to a shared cache. Transfer our own copy.
          const copy = bytes.slice()
          worker.postMessage({ id, bytes: copy }, [copy.buffer])
        } catch (error) {
          close(error)
        }
      })
    },
    close,
  }
}
