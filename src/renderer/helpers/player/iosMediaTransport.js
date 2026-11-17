import { DESKTOP_USER_AGENT } from '../api/capacitor-http.js'

// The playlists and segments of a Twitch recording, in one of the quality folders of `twitchSubOnlyVod.js`
const TWITCH_RECORDING_HOST = /^(?:[a-z0-9-]+\.)+(?:cloudfront\.net|jtvnw\.net|ttvnw\.net|twitch\.tv)$/
const TWITCH_RECORDING_PATH = /^\/(?:[a-zA-Z0-9_]+\/\d{1,20}\/)?[a-zA-Z0-9_-]+\/(?:chunked|1440p60|1080p60|720p60|480p30|360p30|160p30)\/[a-zA-Z0-9_-]+\.(?:m3u8|mp4|ts)$/

/**
 * Twitch's live playlists and recordings reject WebKit's origin, so they load
 * natively, like YouTube's streams. Keep in sync with `IOSNetwork.isMediaURL`.
 * @param {URL} url
 * @returns {boolean} whether iOS playback transports this URL natively
 */
export function isIOSNativeMediaUrl(url) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  const host = url.hostname
  return host === 'googlevideo.com' || host.endsWith('.googlevideo.com') ||
    ((host === 'playlist.ttvnw.net' || host.endsWith('.playlist.ttvnw.net')) && url.pathname.startsWith('/v1/playlist/')) ||
    (TWITCH_RECORDING_HOST.test(host) && TWITCH_RECORDING_PATH.test(url.pathname))
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
        // The parsed URL omits the default port, which the native guard rejects
        url: url.href,
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
