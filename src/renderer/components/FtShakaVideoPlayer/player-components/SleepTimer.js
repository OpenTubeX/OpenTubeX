import shaka from 'shaka-player'
import { watch } from 'vue'

import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'
import {
  formatSleepTimerRemaining,
  MAX_SLEEP_TIMER_MINUTES,
  MIN_SLEEP_TIMER_MINUTES,
  SLEEP_TIMER_PRESET_MINUTES,
  SLEEP_TIMER_STEP_MINUTES,
} from '../opentubex/useSleepTimer'
import { scheduleOverflowMenuScrollClamp } from './overflowMenu'
import { addSliderMenu, choosePreset, fillSlider } from './sliderMenu'

/**
 * Keeps a duration within the range of the slider and snaps it to its step.
 * @param {number} minutes
 * @returns {number}
 */
function normalizeMinutes(minutes) {
  const stepped = Math.round(minutes / SLEEP_TIMER_STEP_MINUTES) * SLEEP_TIMER_STEP_MINUTES
  return Math.min(MAX_SLEEP_TIMER_MINUTES, Math.max(MIN_SLEEP_TIMER_MINUTES, stepped))
}

export class SleepTimer extends shaka.ui.SettingsMenu {
  /**
   * @param {{ durationMinutes: import('vue').Ref<number | null>, mode: import('vue').Ref<'duration' | 'end-of-video' | 'end-of-chapter' | null>, remainingMs: import('vue').Ref<number> }} timer
   * @param {boolean} canEndCurrentVideo
   * @param {import('vue').Ref<number | null>} chapterEndSeconds
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(timer, canEndCurrentVideo, chapterEndSeconds, events, parent, controls) {
    super(parent, controls, PlayerIcons.TIMER_FILLED)

    this.button.classList.add('sleep-timer-button', 'shaka-tooltip-status')
    this.menu.classList.add('sleep-timer-menu')

    /** @private */
    this.timer_ = timer
    /** @private */
    this.chapterEndSeconds_ = chapterEndSeconds
    /** @private */
    this.events_ = events

    /** @type {SVGElement} */
    const checkmarkIcon = new shaka.ui.Icon(null, PlayerIcons.DONE_FILLED).getSvgElement()
    checkmarkIcon.classList.add('shaka-chosen-item')
    checkmarkIcon.ariaHidden = 'true'

    /** @private */
    this.checkmarkIcon_ = checkmarkIcon

    const { value, slider, decreaseButton, increaseButton, presetButtons } = addSliderMenu(this, {
      step: SLEEP_TIMER_STEP_MINUTES,
      presets: SLEEP_TIMER_PRESET_MINUTES,
      onStep: delta => this.startDuration_(normalizeMinutes(this.getSliderMinutes_() + delta)),
      onPreset: minutes => this.startDuration_(minutes),
    })
    /** @private */
    this.value_ = value
    /** @private */
    this.slider_ = slider
    /** @private */
    this.decreaseButton_ = decreaseButton
    /** @private */
    this.increaseButton_ = increaseButton
    /** @private */
    this.presetButtons_ = presetButtons

    // Setting a duration starts the timer, so the slider only sets it once the drag ends, like the caption size slider
    slider.setRange(MIN_SLEEP_TIMER_MINUTES, MAX_SLEEP_TIMER_MINUTES)
    slider.onChange = () => this.showSliderMinutes_(normalizeMinutes(slider.getValue()))
    slider.onChangeEnd = () => this.applySlider_()
    // The arrow keys change the range natively, which only ends with a change event
    this.eventManager.listen(slider.bar, 'change', () => this.applySlider_())
    /**
     * The wheel has no end, so it starts its duration once the wheel rests. Unlike Shaka's
     * `changeTo`, another timer action can cancel that before it starts a stale duration.
     * @private
     * @type {number | null}
     */
    this.wheelCommit_ = null
    this.eventManager.listen(slider.container, 'wheel', (event) => {
      if (event.ctrlKey || event.metaKey) return
      event.preventDefault()
      const delta = event.deltaY > 0 ? -SLEEP_TIMER_STEP_MINUTES : SLEEP_TIMER_STEP_MINUTES
      const minutes = normalizeMinutes(slider.getValue() + delta)
      slider.setValue(minutes)
      this.showSliderMinutes_(minutes)
      window.clearTimeout(this.wheelCommit_)
      this.wheelCommit_ = window.setTimeout(() => {
        this.wheelCommit_ = null
        this.applySlider_()
      }, 500)
    })

    /** @private */
    this.endOfVideoButton_ = this.createOption_(() => i18n.global.t('Video.Player.Sleep Timer.End of video'), () => {
      this.events_.dispatchEvent(new CustomEvent('setSleepTimerEndOfVideo'))
    })
    this.endOfVideoButton_.classList.toggle('shaka-hidden', !canEndCurrentVideo)

    /** @private */
    this.endOfChapterButton_ = this.createOption_(() => i18n.global.t('Video.Player.Sleep Timer.End of current chapter'), () => {
      if (this.chapterEndSeconds_.value !== null) {
        this.events_.dispatchEvent(new CustomEvent('setSleepTimerEndOfChapter', { detail: this.chapterEndSeconds_.value }))
      }
    })

    /** @private */
    this.cancelButton_ = this.createOption_(() => i18n.global.t('Video.Player.Sleep Timer.Cancel timer'), () => {
      this.events_.dispatchEvent(new CustomEvent('cancelSleepTimer'))
    })
    this.cancelButton_.classList.add('sleep-timer-cancel')

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    /** @private */
    this.stopTimerWatch_ = watch(
      [timer.mode, timer.durationMinutes, timer.remainingMs, chapterEndSeconds],
      () => this.updateState_()
    )
    // Not on every second the timer counts down, which would move the slider while it is dragged
    /** @private */
    this.stopSliderWatch_ = watch([timer.mode, timer.durationMinutes], () => this.updateSlider_())

    this.updateLocalisedStrings_()
  }

  release() {
    window.clearTimeout(this.wheelCommit_)
    this.stopTimerWatch_()
    this.stopSliderWatch_()
    this.slider_.release()
    super.release()
  }

  /**
   * @param {number} minutes
   * @private
   */
  startDuration_(minutes) {
    this.cancelWheelCommit_()
    this.events_.dispatchEvent(new CustomEvent('setSleepTimerDuration', { detail: minutes }))
  }

  /**
   * Drops a wheel duration that hasn't started yet. The slider then shows the timer's own
   * duration again, which another action may not change.
   * @private
   */
  cancelWheelCommit_() {
    if (this.wheelCommit_ === null) return
    window.clearTimeout(this.wheelCommit_)
    this.wheelCommit_ = null
    this.updateSlider_()
  }

  /**
   * Starts the slider's duration, unless the timer already runs for it. A drag ends with both
   * `onChangeEnd` and a change event, and clicking the thumb shouldn't restart the timer.
   * @private
   */
  applySlider_() {
    const minutes = normalizeMinutes(this.slider_.getValue())
    if (minutes === this.getSliderMinutes_() && this.timer_.mode.value === 'duration') {
      this.updateSlider_()
    } else {
      this.startDuration_(minutes)
    }
  }

  /**
   * Where the slider shows the duration of the running timer, or its start without one.
   * @returns {number}
   * @private
   */
  getSliderMinutes_() {
    const { durationMinutes, mode } = this.timer_
    return mode.value === 'duration' ? durationMinutes.value : MIN_SLEEP_TIMER_MINUTES
  }

  /**
   * Shows a duration above the slider, while it is dragged or set.
   * @param {number} minutes
   * @private
   */
  showSliderMinutes_(minutes) {
    const label = i18n.global.t('Video.Player.Sleep Timer.Minutes', { minutes })
    this.value_.textContent = label
    this.slider_.bar.ariaValueText = label
    fillSlider(this.slider_, this.controls, minutes)
  }

  /** @private */
  updateSlider_() {
    // Another action changed the timer, so a pending wheel duration is stale
    window.clearTimeout(this.wheelCommit_)
    this.wheelCommit_ = null
    const { durationMinutes, mode } = this.timer_
    const minutes = this.getSliderMinutes_()
    this.slider_.setValue(minutes)
    this.showSliderMinutes_(minutes)
    // Without a timer, the slider starts at the shortest duration, which − starts too
    this.decreaseButton_.disabled = mode.value === 'duration' && minutes <= MIN_SLEEP_TIMER_MINUTES
    this.increaseButton_.disabled = minutes >= MAX_SLEEP_TIMER_MINUTES
    choosePreset(this.presetButtons_, mode.value === 'duration' ? durationMinutes.value : Number.NaN)
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
    this.eventManager.listen(button, 'click', () => {
      this.cancelWheelCommit_()
      onClick()
    })
    return button
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = i18n.global.t('Video.Player.Sleep Timer.Sleep Timer')
    this.button.ariaLabel = label
    this.nameSpan.textContent = label
    this.backSpan.textContent = label
    this.backButton.ariaLabel = this.localization.resolve('BACK')
    this.slider_.bar.ariaLabel = label

    // The presets are short, so that more of them fit on a row
    const format = new Intl.NumberFormat(i18n.global.locale.value, { style: 'unit', unit: 'minute', unitDisplay: 'short' })
    for (const button of this.presetButtons_) {
      button.textContent = format.format(Number(button.dataset.value))
    }

    for (const button of [this.endOfVideoButton_, this.endOfChapterButton_, this.cancelButton_]) {
      button.querySelector('span').textContent = button.getSleepTimerLabel()
    }

    this.updateSlider_()
    this.updateState_()
  }

  /** @private */
  updateState_() {
    const { mode, remainingMs } = this.timer_
    let selectedButton = null
    let status = i18n.global.t('Video.Player.Sleep Timer.Off')

    if (mode.value === 'duration') {
      status = i18n.global.t('Video.Player.Sleep Timer.Remaining', {
        time: formatSleepTimerRemaining(remainingMs.value),
      })
    } else if (mode.value === 'end-of-video') {
      selectedButton = this.endOfVideoButton_
      status = i18n.global.t('Video.Player.Sleep Timer.End of video')
    } else if (mode.value === 'end-of-chapter') {
      selectedButton = this.endOfChapterButton_
      status = i18n.global.t('Video.Player.Sleep Timer.End of current chapter')
    }

    const wasChapterAvailable = !this.endOfChapterButton_.classList.contains('shaka-hidden')
    const chapterAvailable = this.chapterEndSeconds_.value !== null || mode.value === 'end-of-chapter'
    this.endOfChapterButton_.classList.toggle('shaka-hidden', !chapterAvailable)
    if (wasChapterAvailable && !chapterAvailable) {
      const visibleButtons = [...this.menu.children].filter(button =>
        button instanceof HTMLButtonElement && !button.classList.contains('shaka-hidden'))
      scheduleOverflowMenuScrollClamp(this.parent, visibleButtons.at(-1) ?? null)
    }

    for (const button of [this.endOfVideoButton_, this.endOfChapterButton_]) {
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
