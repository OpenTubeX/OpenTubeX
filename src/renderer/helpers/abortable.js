// @ts-check

/**
 * Waits for a promise, but stops waiting once the signal aborts. The work
 * behind the promise keeps running.
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal} signal
 * @returns {Promise<T | undefined>} undefined when the signal aborted first
 */
export function waitUnlessAborted(promise, signal) {
  if (signal.aborted) return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const stop = () => resolve(undefined)
    signal.addEventListener('abort', stop, { once: true })
    promise.then(
      value => { signal.removeEventListener('abort', stop); resolve(value) },
      error => { signal.removeEventListener('abort', stop); reject(error) }
    )
  })
}
