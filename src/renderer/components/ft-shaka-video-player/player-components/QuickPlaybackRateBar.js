import shaka from 'shaka-player'

import i18n from '../../../i18n/index'

const QUICK_PLAYBACK_RATE_OPTIONS = Object.freeze([
  ['50%', 0.5],
  ['75%', 0.75],
  ['normal', 1],
  ['1.25x', 1.25],
  ['1.5x', 1.5],
  ['1.75x', 1.75],
  ['2x', 2],
  ['2.25x', 2.25],
  ['2.5x', 2.5],
  ['3x', 3],
  ['3.5x', 3.5],
])

export class QuickPlaybackRateBar extends shaka.ui.Element {
  /**
   * @param {() => number | null} getSavedChannelPlaybackRate
   * @param {() => boolean} getCanSaveChannelPlaybackSpeed
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(getSavedChannelPlaybackRate, getCanSaveChannelPlaybackSpeed, events, parent, controls) {
    super(parent, controls)

    /** @private */
    this.getSavedChannelPlaybackRate_ = getSavedChannelPlaybackRate

    /** @private */
    this.getCanSaveChannelPlaybackSpeed_ = getCanSaveChannelPlaybackSpeed

    /** @private */
    this.events_ = events

    /** @private */
    this.root_ = document.createElement('div')
    this.root_.classList.add('ft-quick-playback-rate-bar', 'shaka-no-propagation')

    /** @private */
    this.saveButton_ = document.createElement('button')
    this.saveButton_.classList.add('ft-quick-playback-rate-button', 'ft-quick-playback-rate-save')
    this.saveButton_.type = 'button'
    this.root_.appendChild(this.saveButton_)

    /** @private @type {Map<number, HTMLButtonElement>} */
    this.rateButtons_ = new Map()

    for (const [, rate] of QUICK_PLAYBACK_RATE_OPTIONS) {
      const button = document.createElement('button')
      button.classList.add('ft-quick-playback-rate-button')
      button.type = 'button'
      button.dataset.rate = String(rate)

      this.eventManager.listen(button, 'click', () => {
        this.setPlaybackRate_(rate)
        this.events_.dispatchEvent(new CustomEvent('quickPlaybackRateUserSet', {
          detail: rate
        }))
      })

      this.rateButtons_.set(rate, button)
      this.root_.appendChild(button)
    }

    this.parent.appendChild(this.root_)

    this.eventManager.listen(this.saveButton_, 'click', () => {
      this.events_.dispatchEvent(new CustomEvent('saveChannelPlaybackSpeed'))
    })

    this.eventManager.listen(this.player, 'ratechange', () => {
      this.updateButtonStates_()
    })

    this.eventManager.listen(this.video, 'ratechange', () => {
      this.updateButtonStates_()
    })

    this.eventManager.listen(events, 'quickPlaybackRateBarStateChanged', () => {
      this.updateButtonStates_()
    })

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalizedStrings_()
      this.updateButtonStates_()
    })

    this.updateLocalizedStrings_()
    this.updateButtonStates_()
  }

  /** @private */
  updateLocalizedStrings_() {
    this.saveButton_.textContent = i18n.global.t('Video.Player.Set Default')
    this.saveButton_.title = i18n.global.t('Video.Save Channel Playback Speed')
    this.saveButton_.ariaLabel = i18n.global.t('Video.Save Channel Playback Speed')

    for (const [labelKey, rate] of QUICK_PLAYBACK_RATE_OPTIONS) {
      const button = this.rateButtons_.get(rate)
      if (!button) {
        continue
      }

      const label = labelKey === 'normal'
        ? i18n.global.t('Video.Player.Normal')
        : labelKey

      button.textContent = label
      button.title = label
      button.ariaLabel = label
    }
  }

  /** @private */
  updateButtonStates_() {
    const currentRate = this.player.getPlaybackRate?.() ?? this.video.playbackRate
    const savedRate = this.getSavedChannelPlaybackRate_()
    const canSave = this.getCanSaveChannelPlaybackSpeed_()

    if (canSave) {
      this.saveButton_.classList.remove('shaka-hidden')
    } else {
      this.saveButton_.classList.add('shaka-hidden')
    }

    for (const [rate, button] of this.rateButtons_) {
      const isCurrentRate = this.isSameRate_(currentRate, rate)
      const isSavedRate = savedRate != null && this.isSameRate_(savedRate, rate)

      button.classList.toggle('is-current-rate', isCurrentRate)
      button.classList.toggle('is-channel-default-rate', isSavedRate)
      button.ariaPressed = String(isCurrentRate)
    }
  }

  /**
   * @private
   * @param {number} rate
   */
  setPlaybackRate_(rate) {
    this.player.trickPlay(rate, false)
  }

  /**
   * @private
   * @param {number | null | undefined} a
   * @param {number | null | undefined} b
   * @returns {boolean}
   */
  isSameRate_(a, b) {
    return Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) < 0.01
  }
}
