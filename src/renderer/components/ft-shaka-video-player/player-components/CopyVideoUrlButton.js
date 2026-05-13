import shaka from 'shaka-player'

import { copyToClipboard } from '../../../helpers/utils'

export class CopyVideoUrlButton extends shaka.ui.Element {
  /**
   * @param {() => string} getVideoUrl
   * @param {() => string} getLabel
   * @param {() => string} getSuccessMessage
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(getVideoUrl, getLabel, getSuccessMessage, parent, controls) {
    super(parent, controls)

    /** @private */
    this.getVideoUrl_ = getVideoUrl

    /** @private */
    this.getLabel_ = getLabel

    /** @private */
    this.getSuccessMessage_ = getSuccessMessage

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('copy-video-url-button', 'shaka-no-propagation')

    // eslint-disable-next-line no-new
    new shaka.ui.Icon(this.button_, shaka.ui.Enums.MaterialDesignSVGIcons.COPY)

    const label = document.createElement('label')
    label.classList.add(
      'shaka-overflow-button-label',
      'shaka-simple-overflow-button-label-inline'
    )

    /** @private */
    this.nameSpan_ = document.createElement('span')
    label.appendChild(this.nameSpan_)

    this.button_.appendChild(label)
    this.parent.appendChild(this.button_)

    this.eventManager.listen(this.button_, 'click', () => {
      copyToClipboard(this.getVideoUrl_(), {
        messageOnSuccess: this.getSuccessMessage_()
      })

      this.parent.classList.add('shaka-hidden')
    })

    this.eventManager.listen(this.controls, 'contextmenu', () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(this.controls, 'submenuopen', () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(this.localization, shaka.ui.Localization.LOCALE_CHANGED, () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(this.localization, shaka.ui.Localization.LOCALE_UPDATED, () => {
      this.updateLocalisedStrings_()
    })

    this.updateLocalisedStrings_()
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = this.getLabel_()
    this.nameSpan_.textContent = label
    this.button_.ariaLabel = label
  }
}
