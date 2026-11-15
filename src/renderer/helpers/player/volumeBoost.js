/**
 * Gain multipliers applied on top of the player volume. Higher levels clip
 * audibly on already loud videos.
 */
export const VOLUME_BOOST_LEVELS = Object.freeze([1, 1.25, 1.5, 1.75, 2])

export const DEFAULT_VOLUME_BOOST = VOLUME_BOOST_LEVELS[0]

/**
 * @param {unknown} boost
 * @returns {number}
 */
export function sanitizeVolumeBoost(boost) {
  return VOLUME_BOOST_LEVELS.includes(/** @type {number} */ (boost)) ? /** @type {number} */ (boost) : DEFAULT_VOLUME_BOOST
}
