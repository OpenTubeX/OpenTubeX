import shaka from 'shaka-player'

import { chooseAutoVariantsWithDisabled } from './videoCodecPreference'

/**
 * Shaka's ABR, limited to the codecs that Shaka would otherwise keep in the
 * manifest, so automatic quality prefers the same codecs while the resolution
 * menu lists every codec.
 */
export class AutoQualityAbrManager extends shaka.abr.SimpleAbrManager {
  /**
   * @param {string[]} preferredCodecs
   * @param {string[]} preferredDecodingAttributes
   * @param {(videoIds: Set<number>) => void} onVariantsChosen
   */
  constructor(preferredCodecs, preferredDecodingAttributes, onVariantsChosen) {
    super()

    /** @private */
    this.preferredCodecs_ = preferredCodecs
    /** @private */
    this.preferredDecodingAttributes_ = preferredDecodingAttributes
    /** @private */
    this.onVariantsChosen_ = onVariantsChosen
    /**
     * Every variant of the current manifest, including the ones Shaka
     * disables for a while, which it leaves out of `setVariants`
     * @private
     * @type {Set<shaka.extern.Variant>}
     */
    this.knownVariants_ = new Set()
  }

  /** @override */
  stop() {
    this.knownVariants_.clear()
    return super.stop()
  }

  /**
   * @override
   * @param {shaka.extern.Variant[]} variants
   * @param {boolean} isLowLatency
   */
  setVariants(variants, isLowLatency) {
    for (const variant of variants) this.knownVariants_.add(variant)
    const autoVariants = chooseAutoVariantsWithDisabled(
      variants, this.knownVariants_, this.preferredCodecs_, this.preferredDecodingAttributes_
    )
    this.onVariantsChosen_(new Set(autoVariants.map(variant => variant.video?.id)))
    return super.setVariants(autoVariants, isLowLatency)
  }
}

/**
 * Without `changeType`, Shaka only lets ABR switch between variants in the
 * codec of the first one, so it has to keep choosing the codecs itself. Mirrors
 * Shaka's default device check, which isn't exported.
 * @returns {boolean}
 */
export function supportsSmoothCodecSwitching() {
  const sourceBuffer = window.ManagedSourceBuffer ?? window.SourceBuffer
  return typeof sourceBuffer?.prototype?.changeType === 'function'
}
