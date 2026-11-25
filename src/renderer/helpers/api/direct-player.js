// @ts-check

const FALLBACK_KEY = 'directPlayerFallback'

/**
 * Whether videos can skip the watch page and request /player and /next directly.
 * Like the home page fallback, a failure turns this off until OpenTubeX restarts.
 */
export function isDirectPlayerEnabled() {
  return globalThis.sessionStorage?.getItem(FALLBACK_KEY) !== '1'
}

/**
 * @param {string} reason
 */
export function disableDirectPlayer(reason) {
  if (!isDirectPlayerEnabled()) return
  console.warn(`Loading videos through the watch page for the rest of the session: ${reason}`)
  globalThis.sessionStorage?.setItem(FALLBACK_KEY, '1')
}

/**
 * Returns why a /player response for a locally generated session needs the watch page instead.
 * @param {any} playerResponse the raw /player response
 * @returns {string | null} `null` when the response can be used
 */
export function getDirectPlayerFallbackReason(playerResponse) {
  const playability = playerResponse?.playabilityStatus
  if (playability?.status !== 'OK') {
    // The embedded player fallback handles these, as it does after the watch page
    const isAgeRestricted = (playability?.status === 'UNPLAYABLE' || playability?.status === 'LOGIN_REQUIRED') &&
      playability.reason === 'Sign in to confirm your age'
    return isAgeRestricted ? null : `playability status ${playability?.status}: ${playability?.reason}`
  }
  if (!playerResponse.streamingData) return 'no streaming data'
  if (!playerResponse.streamingData.serverAbrStreamingUrl) return 'no SABR streaming URL'
  return null
}
