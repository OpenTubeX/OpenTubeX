/** The Hold to Speed Up multipliers. 0 turns holding off. */
export const HOLD_PLAYBACK_RATE_MULTIPLIERS = Object.freeze([0, 1.25, 1.5, 1.75, 2, 2.5, 3, 4])

/**
 * Settings aren't validated on import or sync, so a multiplier that would not
 * speed playback up turns holding off.
 * @param {unknown} multiplier
 * @returns {number}
 */
export function normalizeHoldPlaybackRateMultiplier(multiplier) {
  return typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier > 1 ? multiplier : 0
}

/**
 * @param {(key: string) => string} t
 * @returns {string[]}
 */
export function getHoldPlaybackRateMultiplierNames(t) {
  return HOLD_PLAYBACK_RATE_MULTIPLIERS.map(multiplier => multiplier === 0
    ? t('Settings.Player Settings.Hold to Speed Up.Off')
    : `${multiplier}x`)
}
