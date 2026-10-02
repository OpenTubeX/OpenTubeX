const MINIMUM_LIVE_DVR_WINDOW_SECONDS = 30

/**
 * Preserve missing DVR metadata instead of coercing it to false, as YouTube.js does.
 * @param {object | null | undefined} videoDetails
 * @returns {boolean | undefined}
 */
export function getLiveDvrEnabled(videoDetails) {
  return typeof videoDetails?.isLiveDvrEnabled === 'boolean'
    ? videoDetails.isLiveDvrEnabled
    : undefined
}

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
  const manifestUrl = response?.data?.streamingData?.hlsManifestUrl
  if (typeof manifestUrl !== 'string') return null

  try {
    const url = new URL(manifestUrl)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
