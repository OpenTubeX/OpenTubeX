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
