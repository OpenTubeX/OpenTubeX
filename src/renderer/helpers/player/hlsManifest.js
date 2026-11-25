import { isIOSNativeMediaUrl } from './iosMediaTransport'

/**
 * @param {string} url
 * @returns {Promise<string | null>} the manifest, `null` when it is unreachable or not HLS
 */
async function fetchHlsManifest(url) {
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
    if (!response.ok) return null
    const manifest = await response.text()
    return manifest.trimStart().startsWith('#EXTM3U') ? manifest : null
  } catch {
    return null
  }
}

/**
 * Checks that a manifest is reachable and contains HLS before selecting it.
 * @param {string} url
 */
export async function probeHlsManifest(url) {
  return await fetchHlsManifest(url) !== null
}

/**
 * Like `probeHlsManifest`, but also tells the HLS rendition of YouTube's mesh
 * videos apart: 360° videos get a 2:1 equirectangular panorama, while VR180
 * videos get a flat view of their front.
 * @param {string} url
 * @returns {Promise<'panorama' | 'flat' | null>} `null` when it is unreachable or not HLS
 */
export async function probeVrHlsManifest(url) {
  const manifest = await fetchHlsManifest(url)
  if (manifest === null) return null
  const aspectRatios = [...manifest.matchAll(/RESOLUTION=(\d+)x(\d+)/g)]
    .map(([, width, height]) => Number(width) / Number(height))
  return aspectRatios.length > 0 && aspectRatios.every(aspectRatio => aspectRatio < 1.9) ? 'flat' : 'panorama'
}
