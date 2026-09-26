import { DESKTOP_USER_AGENT } from '../api/capacitor-http.js'

/** Stream HLS manifests/segments through the same native transport as SABR.
 * Shaka invokes the plugin again on retries, so each attempt gets a fresh URL.
 */
export function createIOSMediaTransport(shaka, native) {
  return (uri, request, ...args) => {
    const url = new URL(uri)
    if (url.protocol !== 'https:' || url.username || url.password ||
        !(url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com')) ||
        !['GET', 'HEAD'].includes(request.method)) {
      return shaka.net.HttpFetchPlugin.parse(uri, request, ...args)
    }

    let aborted = false
    let requestId
    let operation
    const abortNative = () => requestId ? native.abort({ requestId }).catch(() => {}) : Promise.resolve()
    const promise = (async () => {
      const prepared = await native.prepare({
        url: uri,
        method: request.method,
        headers: { 'User-Agent': DESKTOP_USER_AGENT, ...request.headers }
      })
      requestId = prepared.requestId
      if (aborted) {
        await abortNative()
        throw new shaka.util.Error(shaka.util.Error.Severity.RECOVERABLE,
          shaka.util.Error.Category.NETWORK, shaka.util.Error.Code.OPERATION_ABORTED)
      }
      operation = shaka.net.HttpFetchPlugin.parse(
        `/_opentubex_sabr/${encodeURIComponent(requestId)}`, request, ...args)
      try {
        const response = await operation.promise
        // Keep relative playlist URLs based on the remote URL, including redirects.
        response.uri = response.headers['x-opentubex-media-url'] || uri
        response.originalUri = uri
        delete response.headers['x-opentubex-media-url']
        return response
      } catch (error) {
        await abortNative()
        throw error
      }
    })()
    return new shaka.util.AbortableOperation(promise, async () => {
      aborted = true
      await Promise.all([operation?.abort(), abortNative()])
    })
  }
}
