import shaka from 'shaka-player'
import { watch } from 'vue'

import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'

export class AmbientModeButton extends shaka.ui.Element {
  /**
   * @param {import('vue').ComputedRef<boolean>} ambientMode
   * @param {(value: boolean) => void} updateAmbientMode
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(ambientMode, updateAmbientMode, events, parent, controls) {
    super(parent, controls)

    /** @private */
    this.ambientMode_ = ambientMode

    /** @private */
    this.updateAmbientMode_ = updateAmbientMode

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('ambient-mode-button', 'shaka-no-propagation', 'shaka-tooltip')

    /** @private */
    this.icon_ = new shaka.ui.Icon(this.button_, PlayerIcons.LIGHT_MODE_FILLED)

    const label = document.createElement('label')
    label.classList.add(
      'shaka-overflow-button-label',
      'shaka-overflow-menu-only',
      'shaka-simple-overflow-button-label-inline'
    )

    /** @private */
    this.nameSpan_ = document.createElement('span')
    label.appendChild(this.nameSpan_)

    /** @private */
    this.currentState_ = document.createElement('span')
    this.currentState_.classList.add('shaka-current-selection-span', 'ft-toggle-state')

    /** @private */
    this.currentStateValue_ = document.createElement('span')
    this.currentState_.appendChild(this.currentStateValue_)

    /** @private */
    this.currentStateSizer_ = document.createElement('span')
    this.currentStateSizer_.classList.add('ft-toggle-state-sizer')
    this.currentStateSizer_.ariaHidden = 'true'
    this.currentState_.appendChild(this.currentStateSizer_)
    label.appendChild(this.currentState_)

    this.button_.appendChild(label)
    this.parent.appendChild(this.button_)

    this.eventManager.listen(this.button_, 'click', () => {
      this.updateAmbientMode_(!this.ambientMode_.value)
    })

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    if (this.isSubMenu) {
      this.eventManager.listen(this.controls, 'submenuopen', () => {
        this.updateVisibility_()
      })

      this.eventManager.listen(this.controls, 'submenuclose', () => {
        this.updateVisibility_()
      })
    }

    /** @private */
    this.stopAmbientModeWatch_ = watch(this.ambientMode_, () => {
      this.updateLocalisedStrings_()
    })

    this.updateLocalisedStrings_()
  }

  release() {
    this.stopAmbientModeWatch_()
    super.release()
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = i18n.global.t('Global.Ambient Mode')
    const enabledLabel = this.localization.resolve('ON')
    const disabledLabel = this.localization.resolve('OFF')

    this.nameSpan_.textContent = label
    this.currentStateValue_.textContent = this.ambientMode_.value ? enabledLabel : disabledLabel
    this.currentStateSizer_.textContent = this.ambientMode_.value ? disabledLabel : enabledLabel
    this.button_.ariaLabel = label
  }

  /** @private */
  updateVisibility_() {
    this.button_.classList.toggle('shaka-hidden', this.isSubMenuOpened)
  }
}
