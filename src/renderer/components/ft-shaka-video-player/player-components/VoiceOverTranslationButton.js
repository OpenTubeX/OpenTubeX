import shaka from 'shaka-player'
import { watch } from 'vue'

import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'

export class VoiceOverTranslationButton extends shaka.ui.Element {
  /**
   * @param {import('vue').Ref<string>} state
   * @param {import('vue').Ref<boolean>} enabled
   * @param {() => void} toggle
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(state, enabled, toggle, events, parent, controls) {
    super(parent, controls)

    this.state_ = state
    this.enabled_ = enabled
    this.toggle_ = toggle

    this.button_ = document.createElement('button')
    this.button_.classList.add('voice-over-translation-button', 'shaka-no-propagation', 'shaka-tooltip')
    this.icon_ = new shaka.ui.Icon(this.button_, PlayerIcons.RECORD_VOICE_OVER_FILLED)

    const label = document.createElement('label')
    label.classList.add(
      'shaka-overflow-button-label',
      'shaka-overflow-menu-only',
      'shaka-simple-overflow-button-label-inline'
    )

    this.nameSpan_ = document.createElement('span')
    label.appendChild(this.nameSpan_)

    this.currentState_ = document.createElement('span')
    this.currentState_.classList.add('shaka-current-selection-span')
    label.appendChild(this.currentState_)

    this.button_.appendChild(label)
    this.parent.appendChild(this.button_)

    this.eventManager.listen(this.button_, 'click', this.toggle_)
    this.eventManager.listen(events, 'localeChanged', () => this.update_())

    if (this.isSubMenu) {
      this.eventManager.listen(this.controls, 'submenuopen', () => {
        this.updateVisibility_()
      })
      this.eventManager.listen(this.controls, 'submenuclose', () => {
        this.updateVisibility_()
      })
    }

    this.stopStateWatch_ = watch([this.state_, this.enabled_], () => this.update_())
    this.update_()
  }

  release() {
    this.stopStateWatch_()
    super.release()
  }

  update_() {
    const label = i18n.global.t('Video.Player.Voice-over Translation.Voice-over Translation')
    let stateLabel

    if (this.state_.value === 'loading') {
      stateLabel = i18n.global.t('Video.Player.Voice-over Translation.Cancel')
    } else if (this.state_.value === 'error') {
      stateLabel = i18n.global.t('Video.Player.Voice-over Translation.Retry')
    } else if (this.state_.value === 'ready') {
      stateLabel = this.localization.resolve(this.enabled_.value ? 'ON' : 'OFF')
    } else {
      stateLabel = i18n.global.t('Video.Player.Voice-over Translation.Start')
    }

    this.nameSpan_.textContent = label
    this.currentState_.textContent = stateLabel
    this.button_.ariaLabel = `${label}: ${stateLabel}`
    this.button_.ariaPressed = this.enabled_.value ? 'true' : 'false'
    this.button_.classList.toggle('voice-over-translation-loading', this.state_.value === 'loading')
  }

  /** @private */
  updateVisibility_() {
    this.button_.classList.toggle('shaka-hidden', this.isSubMenuOpened)
  }
}
