// @ts-check

const FALLBACK_KEY = 'visionOsStreamsFallback'

/**
 * Whether videos can play the direct streams of the visionOS client. They need
 * neither a PO token nor the player script, and play without SABR and its
 * backoffs. Like the direct player, a refusal turns them off until OpenTubeX restarts.
 */
export function isVisionOsStreamsEnabled() {
  return globalThis.sessionStorage?.getItem(FALLBACK_KEY) !== '1'
}

/**
 * @param {string} reason
 */
export function disableVisionOsStreams(reason) {
  if (!isVisionOsStreamsEnabled()) return
  console.warn(`Playing videos through the WEB client's streams for the rest of the session: ${reason}`)
  globalThis.sessionStorage?.setItem(FALLBACK_KEY, '1')
}

/**
 * @param {string | undefined} url a stream request's URL
 */
export function isVisionOsStreamUrl(url) {
  if (!url) return false
  try {
    const { hostname, searchParams } = new URL(url)
    return hostname.endsWith('.googlevideo.com') && searchParams.get('c') === 'VISIONOS'
  } catch {
    return false
  }
}

/**
 * Returns why a visionOS /player response cannot provide a video's streams.
 * @param {any} playerResponse the raw /player response
 * @param {string} videoId
 * @returns {string | null} `null` when its streams can be used
 */
export function getVisionOsStreamsFallbackReason(playerResponse, videoId) {
  const playability = playerResponse?.playabilityStatus
  if (playability?.status !== 'OK') return `playability status ${playability?.status}: ${playability?.reason}`

  const details = playerResponse.videoDetails
  if (details?.videoId !== videoId) return 'response for another video'
  // Ongoing streams and premieres keep their SABR, HLS and DASH manifests
  if (details.isLive || details.isUpcoming || details.isPostLiveDvr) return 'live or upcoming video'

  const formats = playerResponse.streamingData?.adaptiveFormats
  if (!Array.isArray(formats) || formats.length === 0) return 'no adaptive formats'
  if (formats.some(format => typeof format.url !== 'string')) return 'formats without a direct URL'
  if (formats.some(format => format.drmFamilies)) return 'DRM protected formats'
  return null
}
