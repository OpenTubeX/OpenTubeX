import shaka from 'shaka-player'

import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'

export class ShortsVideoInfoButton extends shaka.ui.Element {
  /**
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(events, parent, controls) {
    super(parent, controls)

    /** @private */
    this.button_ = document.createElement('button')
    const button = this.button_
    button.classList.add('shorts-video-info-button', 'shaka-no-propagation')

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
      events.dispatchEvent(new Event('toggleShortsMetadata'))
    })

    if (this.isSubMenu) {
      this.eventManager.listen(this.controls, 'submenuopen', () => {
        this.updateVisibility_()
      })
      this.eventManager.listen(this.controls, 'submenuclose', () => {
        this.updateVisibility_()
      })
    }
  }

  /** @private */
  updateVisibility_() {
    this.button_.classList.toggle('shaka-hidden', this.isSubMenuOpened)
  }
}
