/**
 * Gain multipliers applied on top of the player volume. Higher levels clip
 * audibly on already loud videos.
 */
export const VOLUME_BOOST_LEVELS = Object.freeze([1, 1.25, 1.5, 1.75, 2])

export const DEFAULT_VOLUME_BOOST = VOLUME_BOOST_LEVELS[0]

/** The step of the volume boost slider, between the levels */
export const VOLUME_BOOST_STEP = 0.05

/**
 * @param {unknown} boost
 * @returns {number}
 */
export function sanitizeVolumeBoost(boost) {
  const value = Number(boost)
  return Number.isFinite(value)
    ? Math.min(VOLUME_BOOST_LEVELS.at(-1), Math.max(DEFAULT_VOLUME_BOOST, value))
    : DEFAULT_VOLUME_BOOST
}
