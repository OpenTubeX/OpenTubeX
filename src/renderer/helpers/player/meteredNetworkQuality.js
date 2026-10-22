import { ref } from 'vue'

/**
 * Whether the active network is metered, like mobile data or a hotspot.
 * Only Android reports it, see `observeAndroidNetworkMetered`.
 */
export const networkMetered = ref(false)

/**
 * Lowers the quality that a video starts at to the `meteredNetworkQualityLimit`
 * setting while the network is metered. Higher qualities can still be picked in the player.
 * Auto stays adaptive, `getMeteredAutoQualityMaxPixels` limits it instead.
 * @param {string} quality a resolution or `auto`
 * @param {string} limit a resolution, or `none` to never lower the quality
 * @returns {string}
 */
export function limitQualityOnMeteredNetwork(quality, limit) {
  if (!networkMetered.value || limit === 'none' || quality === 'auto') {
    return quality
  }

  return Number.parseInt(quality) <= Number.parseInt(limit) ? quality : limit
}

/**
 * The most pixels that auto quality may pick while the network is metered. Counting pixels
 * of the limit's 16:9 resolution matches how qualities are labelled for portrait and ultrawide videos.
 * @param {string} limit a resolution, or `none` to never lower the quality
 * @returns {number}
 */
export function getMeteredAutoQualityMaxPixels(limit) {
  if (!networkMetered.value || limit === 'none') {
    return Infinity
  }

  const height = Number.parseInt(limit)
  // Round the width up to an even number, e.g. 854 for 480p
  return Math.ceil(height * 8 / 9) * 2 * height
}
