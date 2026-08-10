/**
 * shaka-player's default, which means that segments are fetched one after another.
 */
export const DEFAULT_SEGMENT_PREFETCH_LIMIT = 1

export const MAX_SEGMENT_PREFETCH_LIMIT = 10

/**
 * How many segments per stream shaka-player may download in parallel ahead of the playhead.
 *
 * SABR is a stateful protocol, where every request depends on the state that the server
 * returned for the previous one, so parallel segment requests aren't possible there
 * and we have to stick with shaka-player's default.
 * @param {number} configuredLimit the user's setting
 * @param {boolean} isSabr whether the streams are served over SABR
 * @returns {number}
 */
export function resolveSegmentPrefetchLimit(configuredLimit, isSabr) {
  if (isSabr || !Number.isFinite(configuredLimit)) {
    return DEFAULT_SEGMENT_PREFETCH_LIMIT
  }

  return Math.min(
    Math.max(Math.trunc(configuredLimit), DEFAULT_SEGMENT_PREFETCH_LIMIT),
    MAX_SEGMENT_PREFETCH_LIMIT
  )
}
