import shaka from 'shaka-player'

import { PlayerIcons } from '../../../../constants'

export class LegacyQualitySelection extends shaka.ui.SettingsMenu {
  /**
   * @param {() => object | null} getActiveLegacyFormat
   * @param {object[]} legacyFormats
   * @param {EventTarget} events
   * @param {!HTMLElement} parent
   * @param {!shaka.ui.Controls} controls
   */
  constructor(getActiveLegacyFormat, legacyFormats, events, parent, controls) {
    super(parent, controls, PlayerIcons.TUNE_FILLED)

    this.button.classList.add('legacy-quality-button', 'shaka-tooltip-status')
    this.menu.classList.add('legacy-qualities')

    /** @type {SVGElement} */
    const checkmarkIcon = new shaka.ui.Icon(null, PlayerIcons.DONE_FILLED).getSvgElement()
    checkmarkIcon.classList.add('shaka-chosen-item')
    checkmarkIcon.ariaHidden = 'true'

    /** @private */
    this._checkmarkIcon = checkmarkIcon

    /** @private */
    this.events_ = events
    /**
     * Read live so the button reflects the current format regardless of when
     * shaka (re)creates this element relative to the `setLegacyFormat` event.
     * @private
     */
    this.getActiveLegacyFormat_ = getActiveLegacyFormat

    const sortedLegacyFormats = [...legacyFormats]

    const firstFormat = legacyFormats[0]
    const isPortrait = firstFormat ? firstFormat.height > firstFormat.width : false
    sortedLegacyFormats.sort((a, b) => isPortrait ? b.width - a.width : b.height - a.height)

    /** @private */
    this.legacyFormats_ = sortedLegacyFormats

    for (const format of sortedLegacyFormats) {
      const button = document.createElement('button')
      button.classList.add('legacy-resolution')

      this.eventManager.listen(button, 'click', () => {
        this.onFormatSelected_(format)
      })

      const span = document.createElement('span')
      span.textContent = format.qualityLabel
      button.appendChild(span)

      this.menu.appendChild(button)
    }

    // listeners

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(events, 'setLegacyFormat', () => {
      this.updateResolutionSelection_()
    })

    this.eventManager.listen(events, 'legacyFormatMetadataChanged', () => {
      this.updateFormatLabels_()
      this.updateResolutionSelection_()
    })

    // Re-sync after every (re)load, which covers the format-fallback case where
    // this element is recreated before the active format is known.
    this.eventManager.listen(this.player, 'loaded', () => {
      this.updateResolutionSelection_()
    })

    if (this.isSubMenu) {
      this.eventManager.listen(this.controls, 'submenuopen', () => {
        this.button.classList.add('shaka-hidden')
      })

      this.eventManager.listen(this.controls, 'submenuclose', () => {
        this.button.classList.remove('shaka-hidden')
      })
    }

    this.updateResolutionSelection_()
  }

  /** @private */
  updateFormatLabels_() {
    const buttons = this.menu.querySelectorAll('.legacy-resolution')
    this.legacyFormats_.forEach((format, index) => {
      const span = buttons[index]?.querySelector('span')
      if (span) span.textContent = format.qualityLabel
    })
  }

  /** @private */
  updateResolutionSelection_() {
    // Always keep the name/aria labels populated, even before a format is active
    // (e.g. when shaka recreates the controls on a format fallback before
    // `setLegacyFormat` fires), so the button never renders as an icon without a label.
    this.updateLocalisedStrings_()

    const activeLegacyFormat = this.getActiveLegacyFormat_()
    if (!activeLegacyFormat) {
      return
    }

    // remove previous selection

    const previousSpan = this.menu.querySelector('.shaka-chosen-item')
    if (previousSpan) {
      previousSpan.classList.remove('shaka-chosen-item')

      const previousButton = previousSpan.parentElement
      previousButton.ariaSelected = 'false'
      this._checkmarkIcon.remove()
    }

    // current selection

    const index = this.legacyFormats_.indexOf(activeLegacyFormat)
    const button = this.menu.querySelectorAll('.legacy-resolution')[index]

    if (button) {
      const span = button.querySelector('span')

      button.ariaSelected = 'true'
      span.classList.add('shaka-chosen-item')
      button.appendChild(this._checkmarkIcon)

      // only move focus when the menu is actually visible, otherwise this
      // steals focus into a hidden submenu on programmatic updates
      if (button.offsetParent !== null) {
        button.focus()
      }
    }

    // Derive the status text from the active format directly so it stays correct
    // even if the format isn't found in the rendered list.
    this.currentSelection.textContent = activeLegacyFormat.qualityLabel
    this.button.setAttribute('shaka-status', activeLegacyFormat.qualityLabel)
  }

  /** @private */
  async onFormatSelected_(format) {
    if (format === this.getActiveLegacyFormat_()) {
      return
    }

    const playbackPosition = this.player.getMediaElement().currentTime

    const activeCaptionIndex = this.player.getTextTracks().findIndex(caption => caption.active)
    let restoreCaptionIndex = null

    if (activeCaptionIndex >= 0) {
      restoreCaptionIndex = activeCaptionIndex

      // hide captions before switching as shaka/the browser doesn't clean up the displayed captions
      // when switching away from the legacy formats
      this.player.selectTextTrack(null, false)
    }

    this.events_.dispatchEvent(new CustomEvent('setLegacyFormat', {
      detail: {
        format,
        playbackPosition,
        restoreCaptionIndex,
        userSelected: true
      }
    }))
  }

  /** @private */
  updateLocalisedStrings_() {
    const resolutionText = this.localization.resolve('RESOLUTION')

    this.button.ariaLabel = resolutionText
    this.backButton.ariaLabel = resolutionText
    this.backSpan.textContent = resolutionText
    this.nameSpan.textContent = resolutionText
  }
}
