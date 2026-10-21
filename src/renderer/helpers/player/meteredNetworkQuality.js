import { ref } from 'vue'

/**
 * Whether the active network is metered, like mobile data or a hotspot.
 * Only Android reports it, see `observeAndroidNetworkMetered`.
 */
export const networkMetered = ref(false)

/**
 * Lowers the quality that a video starts at to the `meteredNetworkQualityLimit`
 * setting while the network is metered. Higher qualities can still be picked in the player.
 * @param {string} quality a resolution or `auto`
 * @param {string} limit a resolution, or `none` to never lower the quality
 * @returns {string}
 */
export function limitQualityOnMeteredNetwork(quality, limit) {
  if (!networkMetered.value || limit === 'none') {
    return quality
  }

  return Number.parseInt(quality) <= Number.parseInt(limit) ? quality : limit
}
