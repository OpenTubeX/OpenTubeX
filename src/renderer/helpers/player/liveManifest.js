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
