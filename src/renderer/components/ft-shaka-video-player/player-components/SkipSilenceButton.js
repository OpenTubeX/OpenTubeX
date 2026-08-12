import shaka from 'shaka-player'
import { watch } from 'vue'

import { KeyboardShortcuts } from '../../../../constants'
import i18n from '../../../i18n/index'
import { addKeyboardShortcutToActionTitle } from '../../../helpers/utils'

export class SkipSilenceButton extends shaka.ui.Element {
  /**
   * @param {import('vue').ComputedRef<boolean>} skipSilence
   * @param {(value: boolean) => void} updateSkipSilence
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(skipSilence, updateSkipSilence, events, parent, controls) {
    super(parent, controls)

    /** @private */
    this.skipSilence_ = skipSilence

    /** @private */
    this.updateSkipSilence_ = updateSkipSilence

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('skip-silence-button', 'shaka-no-propagation', 'shaka-tooltip')

    /** @private */
    this.icon_ = new shaka.ui.Icon(
      this.button_,
      shaka.ui.Enums.MaterialDesignSVGIcons.FAST_FORWARD
    )

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
      this.updateSkipSilence_(!this.skipSilence_.value)
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
    this.stopSkipSilenceWatch_ = watch(this.skipSilence_, () => {
      this.updateLocalisedStrings_()
    })

    this.updateLocalisedStrings_()
  }

  release() {
    this.stopSkipSilenceWatch_()
    super.release()
  }

  /** @private */
  updateLocalisedStrings_() {
    const baseLabel = i18n.global.t('Settings.Player Settings.Fast-Forward Through Silence')
    const shortcut = KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.TOGGLE_SKIP_SILENCE
    const label = shortcut
      ? addKeyboardShortcutToActionTitle(baseLabel, shortcut)
      : baseLabel
    const enabledLabel = this.localization.resolve('ON')
    const disabledLabel = this.localization.resolve('OFF')

    this.nameSpan_.textContent = label
    this.currentStateValue_.textContent = this.skipSilence_.value ? enabledLabel : disabledLabel
    this.currentStateSizer_.textContent = this.skipSilence_.value ? disabledLabel : enabledLabel
    this.button_.ariaLabel = label
    this.button_.ariaPressed = this.skipSilence_.value ? 'true' : 'false'
  }

  /** @private */
  updateVisibility_() {
    this.button_.classList.toggle('shaka-hidden', this.isSubMenuOpened)
  }
}
