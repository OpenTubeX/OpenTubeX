import shaka from 'shaka-player'
import { watch } from 'vue'

import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'
import {
  formatSleepTimerRemaining,
  SLEEP_TIMER_DURATIONS_MINUTES,
} from '../opentubex/useSleepTimer'

export class SleepTimer extends shaka.ui.SettingsMenu {
  /**
   * @param {{ durationMinutes: import('vue').Ref<number | null>, mode: import('vue').Ref<'duration' | 'end-of-video' | null>, remainingMs: import('vue').Ref<number> }} timer
   * @param {boolean} canEndCurrentVideo
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(timer, canEndCurrentVideo, events, parent, controls) {
    super(parent, controls, PlayerIcons.TIMER_FILLED)

    this.button.classList.add('sleep-timer-button', 'shaka-tooltip-status')
    this.menu.classList.add('sleep-timer-menu')

    /** @private */
    this.timer_ = timer
    /** @private */
    this.events_ = events

    /** @type {SVGElement} */
    const checkmarkIcon = new shaka.ui.Icon(null, PlayerIcons.DONE_FILLED).getSvgElement()
    checkmarkIcon.classList.add('shaka-chosen-item')
    checkmarkIcon.ariaHidden = 'true'

    /** @private */
    this.checkmarkIcon_ = checkmarkIcon
    /** @private */
    this.durationButtons_ = new Map()

    for (const minutes of SLEEP_TIMER_DURATIONS_MINUTES) {
      const button = this.createOption_(() => i18n.global.t('Video.Player.Sleep Timer.Minutes', { minutes }), () => {
        this.events_.dispatchEvent(new CustomEvent('setSleepTimerDuration', { detail: minutes }))
      })
      this.durationButtons_.set(minutes, button)
    }

    /** @private */
    this.endOfVideoButton_ = this.createOption_(() => i18n.global.t('Video.Player.Sleep Timer.End of video'), () => {
      this.events_.dispatchEvent(new CustomEvent('setSleepTimerEndOfVideo'))
    })
    this.endOfVideoButton_.classList.toggle('shaka-hidden', !canEndCurrentVideo)

    /** @private */
    this.cancelButton_ = this.createOption_(() => i18n.global.t('Video.Player.Sleep Timer.Cancel timer'), () => {
      this.events_.dispatchEvent(new CustomEvent('cancelSleepTimer'))
    })
    this.cancelButton_.classList.add('sleep-timer-cancel')

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    if (this.isSubMenu) {
      this.eventManager.listen(this.controls, 'submenuopen', () => {
        this.button.classList.add('shaka-hidden')
      })
      this.eventManager.listen(this.controls, 'submenuclose', () => {
        this.button.classList.remove('shaka-hidden')
      })
    }

    /** @private */
    this.stopTimerWatch_ = watch(
      [timer.mode, timer.durationMinutes, timer.remainingMs],
      () => this.updateState_()
    )

    this.updateLocalisedStrings_()
    this.updateState_()
  }

  release() {
    this.stopTimerWatch_()
    super.release()
  }

  /**
   * @param {() => string} getLabel
   * @param {() => void} onClick
   * @returns {HTMLButtonElement}
   * @private
   */
  createOption_(getLabel, onClick) {
    const button = document.createElement('button')
    const label = document.createElement('span')
    button.appendChild(label)
    this.menu.appendChild(button)

    button.getSleepTimerLabel = getLabel
    this.eventManager.listen(button, 'click', onClick)
    return button
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = i18n.global.t('Video.Player.Sleep Timer.Sleep Timer')
    this.button.ariaLabel = label
    this.nameSpan.textContent = label
    this.backSpan.textContent = label
    this.backButton.ariaLabel = this.localization.resolve('BACK')

    for (const button of this.menu.querySelectorAll('button:not(.shaka-back-to-overflow-button)')) {
      button.querySelector('span').textContent = button.getSleepTimerLabel()
    }

    this.updateState_()
  }

  /** @private */
  updateState_() {
    const { durationMinutes, mode, remainingMs } = this.timer_
    let selectedButton = null
    let status = i18n.global.t('Video.Player.Sleep Timer.Off')

    if (mode.value === 'duration') {
      selectedButton = this.durationButtons_.get(durationMinutes.value)
      status = i18n.global.t('Video.Player.Sleep Timer.Remaining', {
        time: formatSleepTimerRemaining(remainingMs.value),
      })
    } else if (mode.value === 'end-of-video') {
      selectedButton = this.endOfVideoButton_
      status = i18n.global.t('Video.Player.Sleep Timer.End of video')
    }

    for (const button of [...this.durationButtons_.values(), this.endOfVideoButton_]) {
      const isSelected = button === selectedButton
      const label = button.querySelector('span')
      label.classList.toggle('shaka-chosen-item', isSelected)
      button.ariaSelected = isSelected ? 'true' : 'false'

      if (isSelected) {
        button.appendChild(this.checkmarkIcon_)
      }
    }

    if (selectedButton === null) {
      this.checkmarkIcon_.remove()
    }

    this.cancelButton_.classList.toggle('shaka-hidden', mode.value === null)
    // A running timer highlights the entry in the overflow menu. This isn't a
    // toggle button, so it can't use `aria-pressed` for it.
    this.button.classList.toggle('ft-active', mode.value !== null)
    this.currentSelection.textContent = status
    this.button.setAttribute('shaka-status', status)
  }
}
