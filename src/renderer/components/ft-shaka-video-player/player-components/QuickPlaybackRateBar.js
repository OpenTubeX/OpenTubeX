import shaka from 'shaka-player'

import i18n from '../../../i18n/index'

/**
 * @typedef {{ speed: number, name?: string }} QuickPlaybackRateOption
 */

/**
 * @typedef {object} QuickPlaybackRateBarContext
 * @property {() => QuickPlaybackRateOption[]} getPlaybackRateOptions
 * @property {() => number | null} getSavedChannelPlaybackRate
 * @property {() => boolean} getCanSaveChannelPlaybackSpeed
 * @property {EventTarget} events
 */

/**
 * Shaka's element registry is shared by every player in the renderer. Resolve
 * instance-specific state through the Controls object instead of capturing the
 * state of whichever player registered the global factory most recently.
 * @type {WeakMap<shaka.ui.Controls, QuickPlaybackRateBarContext>}
 */
const quickPlaybackRateBarContexts = new WeakMap()

/**
 * @param {shaka.ui.Controls} controls
 * @param {QuickPlaybackRateBarContext} context
 * @returns {() => void}
 */
export function setQuickPlaybackRateBarContext(controls, context) {
  quickPlaybackRateBarContexts.set(controls, context)

  return () => {
    if (quickPlaybackRateBarContexts.get(controls) === context) {
      quickPlaybackRateBarContexts.delete(controls)
    }
  }
}

export class QuickPlaybackRateBar extends shaka.ui.Element {
  /**
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(parent, controls) {
    super(parent, controls)

    /** @private */
    this.root_ = document.createElement('div')
    this.root_.classList.add('ft-quick-playback-rate-bar', 'shaka-no-propagation')

    /** @private */
    this.saveButton_ = document.createElement('button')
    this.saveButton_.classList.add('ft-quick-playback-rate-button', 'ft-quick-playback-rate-save')
    this.saveButton_.type = 'button'
    this.root_.appendChild(this.saveButton_)

    /** @private @type {Array<{speed: number, button: HTMLButtonElement}>} */
    this.rateButtons_ = []

    this.parent.appendChild(this.root_)

    this.eventManager.listen(this.saveButton_, 'click', () => {
      quickPlaybackRateBarContexts.get(this.controls)?.events.dispatchEvent(new CustomEvent('saveChannelPlaybackSpeed'))
    })

    this.eventManager.listen(this.player, 'ratechange', () => {
      this.updateButtonStates_()
    })

    this.eventManager.listen(this.video, 'ratechange', () => {
      this.updateButtonStates_()
    })

    const context = quickPlaybackRateBarContexts.get(this.controls)
    if (context) {
      this.eventManager.listen(context.events, 'quickPlaybackRateBarStateChanged', () => {
        this.rebuildRateButtons_()
        this.updateButtonStates_()
      })

      this.eventManager.listen(context.events, 'localeChanged', () => {
        this.updateLocalizedStrings_()
        this.updateButtonStates_()
      })
    }

    this.rebuildRateButtons_()
    this.updateLocalizedStrings_()
    this.updateButtonStates_()
  }

  /** @private */
  rebuildRateButtons_() {
    for (const { button } of this.rateButtons_) {
      button.remove()
    }

    this.rateButtons_ = []

    const context = quickPlaybackRateBarContexts.get(this.controls)
    for (const { speed } of context?.getPlaybackRateOptions() ?? []) {
      const button = document.createElement('button')
      button.classList.add('ft-quick-playback-rate-button')
      button.type = 'button'
      button.dataset.rate = String(speed)

      button.addEventListener('click', () => {
        this.setPlaybackRate_(speed)
        quickPlaybackRateBarContexts.get(this.controls)?.events.dispatchEvent(new CustomEvent('quickPlaybackRateUserSet', {
          detail: speed
        }))
      })

      this.rateButtons_.push({ speed, button })
      this.root_.appendChild(button)
    }

    this.updateLocalizedStrings_()
  }

  /** @private */
  updateLocalizedStrings_() {
    this.saveButton_.textContent = i18n.global.t('Video.Player.Set Default')
    this.saveButton_.title = i18n.global.t('Video.Save Channel Playback Speed')
    this.saveButton_.ariaLabel = i18n.global.t('Video.Save Channel Playback Speed')

    const options = quickPlaybackRateBarContexts.get(this.controls)?.getPlaybackRateOptions() ?? []

    for (const [index, { speed, name }] of options.entries()) {
      const entry = this.rateButtons_[index]
      if (!entry) {
        continue
      }

      const label = this.getPlaybackRateLabel_(speed, name)

      entry.button.textContent = label
      entry.button.title = label
      entry.button.ariaLabel = label
    }
  }

  /**
   * @private
   * @param {number} speed
   * @param {string | null | undefined} name
   * @returns {string}
   */
  getPlaybackRateLabel_(speed, name) {
    if (typeof name === 'string' && name.trim() !== '') {
      return name.trim()
    }

    if (this.isSameRate_(speed, 1)) {
      return i18n.global.t('Video.Player.Normal')
    }

    if (speed < 1) {
      return `${Math.round(speed * 100)}%`
    }

    return `${speed}x`
  }

  /** @private */
  updateButtonStates_() {
    const context = quickPlaybackRateBarContexts.get(this.controls)
    const currentRate = this.player.getPlaybackRate?.() ?? this.video.playbackRate
    const savedRate = context?.getSavedChannelPlaybackRate() ?? null
    const canSave = context?.getCanSaveChannelPlaybackSpeed() ?? false

    if (canSave) {
      this.saveButton_.classList.remove('shaka-hidden')
    } else {
      this.saveButton_.classList.add('shaka-hidden')
    }

    for (const { speed, button } of this.rateButtons_) {
      const isCurrentRate = this.isSameRate_(currentRate, speed)
      const isSavedRate = savedRate != null && this.isSameRate_(savedRate, speed)

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
