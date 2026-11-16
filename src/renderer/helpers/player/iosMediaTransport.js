import { DESKTOP_USER_AGENT } from '../api/capacitor-http.js'

/**
 * Twitch's live playlists reject WebKit's origin, so they load natively, like
 * YouTube's streams. Keep in sync with `IOSNetwork.isMediaURL`.
 * @param {URL} url
 * @returns {boolean} whether iOS playback transports this URL natively
 */
export function isIOSNativeMediaUrl(url) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  const host = url.hostname
  return host === 'googlevideo.com' || host.endsWith('.googlevideo.com') ||
    ((host === 'playlist.ttvnw.net' || host.endsWith('.playlist.ttvnw.net')) && url.pathname.startsWith('/v1/playlist/'))
}

/** Stream HLS manifests/segments through the same native transport as SABR.
 * Shaka invokes the plugin again on retries, so each attempt gets a fresh URL.
 * `parse` performs the WebView requests, Shaka's fetch plugin by default.
 */
export function createIOSMediaTransport(shaka, native, parse = shaka.net.HttpFetchPlugin.parse) {
  return (uri, request, ...args) => {
    const url = new URL(uri)
    if (!isIOSNativeMediaUrl(url) || !['GET', 'HEAD'].includes(request.method)) {
      return parse(uri, request, ...args)
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
      const localUri = `/_opentubex_sabr/${encodeURIComponent(requestId)}`
      operation = parse(localUri, request, ...args)
      try {
        const response = await operation.promise
        // Keep relative playlist URLs based on the remote URL, including redirects.
        response.uri = response.headers['x-opentubex-media-url'] || uri
        response.originalUri = uri
        delete response.headers['x-opentubex-media-url']
        return response
      } catch (error) {
        await abortNative()
        // Error handling inspects the stream's URL, not the local one
        if (error instanceof shaka.util.Error && error.data?.[0] === localUri) error.data[0] = uri
        throw error
      }
    })()
    return new shaka.util.AbortableOperation(promise, async () => {
      aborted = true
      await Promise.all([operation?.abort(), abortNative()])
    })
  }
}
