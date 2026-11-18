import { isIOSNativeMediaUrl } from './iosMediaTransport'

/**
 * Checks that a manifest is reachable and contains HLS before selecting it.
 * @param {string} url
 */
export async function probeHlsManifest(url) {
  try {
    const options = { signal: AbortSignal.timeout(10000) }
    let response
    if (process.env.IS_IOS && isIOSNativeMediaUrl(new URL(url))) {
      // Small manifest bodies can use native HTTP without streaming media bytes
      // through the bridge. WebKit cannot always fetch Googlevideo directly.
      const { capacitorHttpFetch } = await import('../api/capacitor-http')
      response = await capacitorHttpFetch(url, { ...options, nativeTimeoutMs: 10000 })
    } else {
      response = await fetch(url, options)
    }
    return response.ok && (await response.text()).trimStart().startsWith('#EXTM3U')
  } catch {
    return false
  }
}
