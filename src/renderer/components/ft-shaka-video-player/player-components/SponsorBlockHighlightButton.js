import shaka from 'shaka-player'

import { PlayerIcons, SPONSORBLOCK_ICON_VIEWBOX } from '../../../../constants'
import { addKeyboardShortcutToActionTitle } from '../../../helpers/utils'
import i18n from '../../../i18n/index'

export class SponsorBlockHighlightButton extends shaka.ui.Element {
  /**
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(events, parent, controls) {
    super(parent, controls)

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('ft-shaka-highlight-button', 'shaka-tooltip', 'shaka-hidden')

    // eslint-disable-next-line no-new
    new shaka.ui.Icon(this.button_, {
      path: PlayerIcons.SPONSORBLOCK_HIGHLIGHT,
      viewBox: SPONSORBLOCK_ICON_VIEWBOX,
    })

    /** @private */
    this.nameSpan_ = document.createElement('span')
    this.nameSpan_.classList.add('ft-shaka-highlight-button-label')
    this.button_.appendChild(this.nameSpan_)
    this.parent.appendChild(this.button_)

    this.eventManager.listen(this.button_, 'click', () => {
      events.dispatchEvent(new CustomEvent('skipToSponsorBlockHighlight'))
    })

    this.eventManager.listen(events, 'sponsorBlockHighlightStateChanged', (/** @type {CustomEvent} */ event) => {
      this.updateVisibility_(event.detail)
    })

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    this.updateLocalisedStrings_()
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = addKeyboardShortcutToActionTitle(
      i18n.global.t('Video.Player.SponsorBlock.SkipToHighlight'),
      i18n.global.t('Keys.enter')
    )
    const tooltipLabel = i18n.global.t('Video.Player.SponsorBlock.SkipToHighlight').replace(/\?$/, '')

    this.nameSpan_.textContent = label
    this.button_.ariaLabel = tooltipLabel
  }

  /**
   * @private
   * @param {{ visible: boolean }} state
   */
  updateVisibility_(state) {
    if (state.visible) {
      this.button_.classList.remove('shaka-hidden')
    } else {
      this.button_.classList.add('shaka-hidden')
    }
  }
}
