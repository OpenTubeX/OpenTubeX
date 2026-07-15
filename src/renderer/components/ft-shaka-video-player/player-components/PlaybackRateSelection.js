import shaka from 'shaka-player'

import { PlayerIcons } from '../../../../constants'

export class PlaybackRateSelection extends shaka.ui.SettingsMenu {
  /**
   * @param {() => number | null} getPlaybackRate
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(getPlaybackRate, events, parent, controls) {
    super(parent, controls, shaka.ui.Enums.MaterialDesignSVGIcons.PLAYBACK_RATE)

    this.button.classList.add('shaka-playbackrate-button', 'shaka-tooltip-status')
    this.menu.classList.add('shaka-playback-rates')

    /** @private */
    this.getPlaybackRate_ = getPlaybackRate

    /** @private */
    this.rateButtons_ = new Map()

    /** @private @type {SVGElement} */
    this.checkmarkIcon_ = new shaka.ui.Icon(null, PlayerIcons.DONE_FILLED).getSvgElement()
    this.checkmarkIcon_.classList.add('shaka-chosen-item')
    this.checkmarkIcon_.ariaHidden = 'true'

    /** @private @type {HTMLElement | null} */
    this.playbackRateMark_ = null
    if (!this.isSubMenu) {
      this.playbackRateMark_ = document.createElement('span')
      this.playbackRateMark_.classList.add('shaka-overflow-playback-rate-mark')
      this.button.appendChild(this.playbackRateMark_)
    }

    for (const rate of this.controls.getConfig().playbackRates) {
      const button = document.createElement('button')
      const label = document.createElement('span')
      label.textContent = `${rate}x`
      button.appendChild(label)
      this.menu.appendChild(button)
      this.rateButtons_.set(rate, { button, label })

      this.eventManager.listen(button, 'click', () => {
        if (Math.abs(rate - this.video.defaultPlaybackRate) < 0.01) {
          this.player.cancelTrickPlay()
        } else {
          this.player.trickPlay(rate, false)
        }
      })
    }

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listenMulti(this.player, ['loaded', 'ratechange'], () => {
      // Let the player classify the rate change as user-selected or temporary
      // before reading the normal playback rate.
      queueMicrotask(() => this.updateSelection_())
    })

    if (this.isSubMenu) {
      this.eventManager.listen(this.controls, 'submenuopen', () => {
        this.button.classList.add('shaka-hidden')
      })
      this.eventManager.listen(this.controls, 'submenuclose', () => {
        this.button.classList.remove('shaka-hidden')
      })
    }

    this.updateLocalisedStrings_()
    this.updateSelection_()
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = this.localization.resolve('PLAYBACK_RATE')
    this.backButton.ariaLabel = this.localization.resolve('BACK')
    this.button.ariaLabel = label
    this.nameSpan.textContent = label
    this.backSpan.textContent = label
  }

  /** @private */
  updateSelection_() {
    const playbackRate = this.getPlaybackRate_() ?? this.player.getPlaybackRate()
    const status = `${playbackRate}x`

    if (this.currentSelection.textContent === status) {
      return
    }

    let selectedButton = null

    for (const [rate, { button, label }] of this.rateButtons_) {
      const selected = Math.abs(rate - playbackRate) < 0.01
      label.classList.toggle('shaka-chosen-item', selected)

      if (selected) {
        button.ariaSelected = 'true'
        selectedButton = button
      } else {
        button.removeAttribute('aria-selected')
      }
    }

    if (selectedButton) {
      if (this.checkmarkIcon_.parentElement !== selectedButton) {
        selectedButton.appendChild(this.checkmarkIcon_)
      }
    } else {
      this.checkmarkIcon_.remove()
    }

    this.currentSelection.textContent = status
    this.playbackRateMark_?.replaceChildren(status)
    this.button.setAttribute('shaka-status', status)
  }
}
