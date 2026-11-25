export const SYNC_SERVER_VERSION_HEADER = 'OpenTubeX-Client-Version'

/**
 * Move the internal sync version marker into the outgoing user agent.
 * @param {Record<string, string | string[]>} requestHeaders
 * @returns {Record<string, string | string[]>}
 */
export function applySyncServerUserAgent(requestHeaders) {
  const markerName = Object.keys(requestHeaders).find(
    name => name.toLowerCase() === SYNC_SERVER_VERSION_HEADER.toLowerCase()
  )
  if (!markerName) return requestHeaders

  const markerValue = requestHeaders[markerName]
  const version = Array.isArray(markerValue) ? markerValue[0] : markerValue
  delete requestHeaders[markerName]
  if (version) {
    requestHeaders['User-Agent'] = `OpenTubeX/${version}`
  }

  return requestHeaders
}
