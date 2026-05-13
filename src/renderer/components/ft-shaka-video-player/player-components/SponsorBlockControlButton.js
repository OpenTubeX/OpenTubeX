import shaka from 'shaka-player'

import { SPONSORBLOCK_ICON_VIEWBOX } from '../../../../constants'
import i18n from '../../../i18n/index'

/**
 * @typedef {'start' | 'end' | 'menu' | 'cancel' | 'clear'} SponsorBlockButtonType
 */

export class SponsorBlockControlButton extends shaka.ui.Element {
  /**
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   * @param {{
   *   className: string
   *   eventName: string
   *   iconPath: string
   *   labelKey: string
   *   type: SponsorBlockButtonType
   * }} options
   */
  constructor(events, parent, controls, options) {
    super(parent, controls)

    this.type_ = options.type
    this.labelKey_ = options.labelKey

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add(options.className, 'shaka-tooltip', 'ft-shaka-sponsorblock-button')

    // eslint-disable-next-line no-new
    new shaka.ui.Icon(this.button_, {
      path: options.iconPath,
      viewBox: SPONSORBLOCK_ICON_VIEWBOX,
    })

    const label = document.createElement('label')
    label.classList.add(
      'shaka-overflow-button-label',
      'shaka-overflow-menu-only',
      'shaka-simple-overflow-button-label-inline'
    )

    /** @private */
    this.nameSpan_ = document.createElement('span')
    label.appendChild(this.nameSpan_)
    this.button_.appendChild(label)
    this.parent.appendChild(this.button_)

    this.eventManager.listen(this.button_, 'click', () => {
      events.dispatchEvent(new CustomEvent(options.eventName))
    })

    this.eventManager.listen(events, 'sponsorBlockSubmissionStateChanged', (/** @type {CustomEvent} */ event) => {
      this.updateVisibility_(event.detail)
    })

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    if (this.isSubMenu) {
      this.button_.classList.add('shaka-hidden')
    }

    this.updateLocalisedStrings_()
    this.updateVisibility_({
      visibleButtons: []
    })
  }

  /** @private */
  updateLocalisedStrings_() {
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    const label = i18n.global.t(this.labelKey_)
    this.nameSpan_.textContent = this.button_.ariaLabel = label
  }

  /**
   * @private
   * @param {{ visibleButtons: SponsorBlockButtonType[] }} state
   */
  updateVisibility_(state) {
    if (this.isSubMenu || !state.visibleButtons.includes(this.type_)) {
      this.button_.classList.add('shaka-hidden')
    } else {
      this.button_.classList.remove('shaka-hidden')
    }
  }
}
