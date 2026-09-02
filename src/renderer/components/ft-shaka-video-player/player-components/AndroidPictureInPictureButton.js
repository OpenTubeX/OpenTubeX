import shaka from 'shaka-player'

import i18n from '../../../i18n/index'

export class AndroidPictureInPictureButton extends shaka.ui.Element {
  constructor(events, parent, controls) {
    super(parent, controls)

    this.button_ = document.createElement('button')
    this.button_.classList.add('shaka-pip-button', 'shaka-tooltip', 'shaka-no-propagation')
    // eslint-disable-next-line no-new
    new shaka.ui.Icon(this.button_, shaka.ui.Enums.MaterialDesignSVGIcons.PIP)

    const label = document.createElement('label')
    label.classList.add(
      'shaka-overflow-button-label',
      'shaka-overflow-menu-only',
      'shaka-simple-overflow-button-label-inline'
    )
    this.nameSpan_ = document.createElement('span')
    label.appendChild(this.nameSpan_)
    this.button_.appendChild(label)
    this.parent.appendChild(this.button_)

    this.eventManager.listen(this.button_, 'click', () => {
      events.dispatchEvent(new CustomEvent('enterAndroidPictureInPicture'))
    })
    this.eventManager.listen(events, 'localeChanged', () => this.updateLocalisedStrings_())

    if (this.isSubMenu) {
      this.eventManager.listen(this.controls, 'submenuopen', () => this.updateVisibility_())
      this.eventManager.listen(this.controls, 'submenuclose', () => this.updateVisibility_())
    }

    this.updateLocalisedStrings_()
  }

  updateLocalisedStrings_() {
    const label = i18n.global.t('KeyboardShortcutPrompt.Picture in Picture')
    this.nameSpan_.textContent = this.button_.ariaLabel = label
  }

  updateVisibility_() {
    this.button_.classList.toggle('shaka-hidden', this.isSubMenuOpened)
  }
}
