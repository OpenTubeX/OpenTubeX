// Chromium ignores the User-Agent header of renderer requests, so the
// Electron renderer names the client in this header and the main process
// sends that client's user agent instead.
export const YOUTUBE_USER_AGENT_HEADER = 'OpenTubeX-YouTube-User-Agent'

/** The YouTube TV clients the account sign-in and watch history need. */
export const YOUTUBE_USER_AGENTS = Object.freeze({
  // youtube.com/tv only links the script with the OAuth client to TVs.
  tv: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
  // The signed-in TV player only answers playable to this TV.
  tizen: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1'
})

/**
 * Move the client marker into the User-Agent of a YouTube request.
 * @param {string} url
 * @param {Record<string, string | string[]>} requestHeaders
 * @returns {Record<string, string | string[]>}
 */
export function applyYouTubeUserAgent(url, requestHeaders) {
  const markerName = Object.keys(requestHeaders).find(
    name => name.toLowerCase() === YOUTUBE_USER_AGENT_HEADER.toLowerCase()
  )
  if (!markerName) return requestHeaders

  const markerValue = requestHeaders[markerName]
  const client = Array.isArray(markerValue) ? markerValue[0] : markerValue
  delete requestHeaders[markerName]
  if (url.startsWith('https://www.youtube.com/') && Object.hasOwn(YOUTUBE_USER_AGENTS, client)) {
    const userAgentName = Object.keys(requestHeaders).find(name => name.toLowerCase() === 'user-agent') ?? 'User-Agent'
    requestHeaders[userAgentName] = YOUTUBE_USER_AGENTS[client]
  }

  return requestHeaders
}
