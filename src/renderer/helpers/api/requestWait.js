import { createAbortError } from './requestErrors.js'

/**
 * @template T
 * @param {Promise<T>} request
 * @param {AbortSignal | undefined} signal
 * @param {(() => void) | undefined} abortNative
 */
export function waitForRequest(request, signal, abortNative) {
  if (!signal) return request
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      abortNative?.()
      reject(createAbortError())
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })

    request.then(
      (response) => {
        signal.removeEventListener('abort', onAbort)
        resolve(response)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}
