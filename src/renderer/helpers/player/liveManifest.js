const MINIMUM_LIVE_DVR_WINDOW_SECONDS = 30

/**
 * @param {string | null} url
 * @returns {boolean}
 */
export function hasLimitedLiveDvrWindow(url) {
  const duration = getLiveDvrWindowSeconds(url)
  return duration != null && duration <= MINIMUM_LIVE_DVR_WINDOW_SECONDS
}

/**
 * @param {string | null} url
 * @returns {number | null}
 */
export function getLiveDvrWindowSeconds(url) {
  const match = url?.match(/\/(?:manifest|playlist)_duration\/(\d+)\//)
  return match != null ? parseInt(match[1], 10) : null
}

/**
 * The WEB player response occasionally omits live manifests while the
 * parallel ANDROID response still contains one.
 * @param {unknown} response
 * @returns {string | null}
 */
export function getAndroidLiveHlsManifestUrl(response) {
  return getAndroidLiveManifestUrl(response, 'hlsManifestUrl')
}

/**
 * Android can provide a rewindable DASH stream when WEB HLS only has 30 seconds.
 * @param {unknown} response
 * @returns {string | null}
 */
export function getAndroidLiveDashManifestUrl(response) {
  return getAndroidLiveManifestUrl(response, 'dashManifestUrl')
}

/**
 * @param {unknown} response
 * @param {'hlsManifestUrl' | 'dashManifestUrl'} field
 * @returns {string | null}
 */
function getAndroidLiveManifestUrl(response, field) {
  const manifestUrl = response?.data?.streamingData?.[field]
  if (typeof manifestUrl !== 'string') return null

  try {
    const url = new URL(manifestUrl)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
