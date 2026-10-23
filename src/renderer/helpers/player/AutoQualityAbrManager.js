import shaka from 'shaka-player'

import { chooseAutoVariants } from './videoCodecPreference'

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
  }

  /**
   * @override
   * @param {shaka.extern.Variant[]} variants
   * @param {boolean} isLowLatency
   */
  setVariants(variants, isLowLatency) {
    const autoVariants = chooseAutoVariants(variants, this.preferredCodecs_, this.preferredDecodingAttributes_)
    this.onVariantsChosen_(new Set(autoVariants.map(variant => variant.video?.id)))
    return super.setVariants(autoVariants, isLowLatency)
  }
}
