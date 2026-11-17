import shaka from 'shaka-player'

import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'

/**
 * Opens the video information panel from the overflow menu, for Shorts and
 * for full screen videos whose title, which also opens it, is hidden.
 */
export class VideoInfoButton extends shaka.ui.Element {
  /**
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   * @param {() => boolean} isAvailable Checked whenever the menu opens
   */
  constructor(events, parent, controls, isAvailable) {
    super(parent, controls)

    /** @private */
    this.isAvailable_ = isAvailable

    /** @private */
    this.button_ = document.createElement('button')
    const button = this.button_
    button.classList.add('video-info-button', 'shaka-no-propagation')

    // eslint-disable-next-line no-new
    new shaka.ui.Icon(button, PlayerIcons.INFO_FILLED)

    const label = document.createElement('label')
    label.classList.add(
      'shaka-overflow-button-label',
      'shaka-overflow-menu-only',
      'shaka-simple-overflow-button-label-inline'
    )
    label.textContent = i18n.global.t('Video.Metadata')
    button.appendChild(label)
    button.ariaLabel = label.textContent

    this.parent.appendChild(button)
    this.eventManager.listen(button, 'click', () => {
      this.controls.hideSettingsMenus()
      events.dispatchEvent(new Event('toggleVideoInfo'))
    })
    this.updateVisibility_()
  }

  /** @private */
  updateVisibility_() {
    // Shaka focuses the first entry without shaka-hidden when the menu opens.
    this.button_.classList.toggle('shaka-hidden', this.isSubMenuOpened || !this.isAvailable_())
  }

  /** @override */
  checkAvailability() {
    this.updateVisibility_()
  }
}
