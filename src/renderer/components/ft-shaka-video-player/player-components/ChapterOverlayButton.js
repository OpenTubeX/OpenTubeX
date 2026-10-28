import shaka from 'shaka-player'
import { watch } from 'vue'

import i18n from '../../../i18n/index'

export class ChapterOverlayButton extends shaka.ui.Element {
  /**
   * @param {import('vue').ComputedRef<string>} currentChapterTitle
   * @param {import('vue').ComputedRef<boolean>} chaptersAvailable
   * @param {boolean} overlayOpen
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(currentChapterTitle, chaptersAvailable, overlayOpen, events, parent, controls) {
    super(parent, controls)

    /** @private */
    this.currentChapterTitle_ = currentChapterTitle

    /** @private */
    this.chaptersAvailable_ = chaptersAvailable

    /** @private */
    this.overlayOpen_ = overlayOpen

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('ft-chapters-button', 'shaka-no-propagation', 'shaka-tooltip')

    /** @private */
    this.icon_ = new shaka.ui.Icon(
      this.button_,
      shaka.ui.Enums.MaterialDesignSVGIcons.CHAPTER
    )
    this.icon_.getSvgElement().classList.add('ft-chapters-icon')

    /** @private */
    this.currentTitleSpan_ = document.createElement('span')
    this.currentTitleSpan_.classList.add('ft-chapters-current-title')
    this.button_.appendChild(this.currentTitleSpan_)

    const chevron = document.createElement('span')
    chevron.classList.add('ft-chapters-chevron')
    chevron.textContent = '›'
    chevron.ariaHidden = 'true'
    this.button_.appendChild(chevron)

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
    this.currentState_.classList.add('shaka-current-selection-span')
    label.appendChild(this.currentState_)

    this.button_.appendChild(label)
    this.parent.appendChild(this.button_)

    this.eventManager.listen(this.button_, 'click', () => {
      events.dispatchEvent(new CustomEvent('setChaptersOverlay', {
        detail: !this.overlayOpen_
      }))
    })

    this.eventManager.listen(events, 'setChaptersOverlay', (/** @type {CustomEvent} */ event) => {
      this.overlayOpen_ = event.detail
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    /** @private */
    this.stopCurrentChapterTitleWatch_ = watch(this.currentChapterTitle_, () => {
      this.updateLocalisedStrings_()
    })

    // The control stays registered for every video so chapters loading later
    // do not rebuild the player controls; it only hides without chapters.
    /** @private */
    this.stopChaptersAvailableWatch_ = watch(this.chaptersAvailable_, () => {
      this.updateVisibility_()
    })

    this.updateLocalisedStrings_()
    this.updateVisibility_()
  }

  release() {
    this.stopCurrentChapterTitleWatch_()
    this.stopChaptersAvailableWatch_()
    super.release()
  }

  /** @private */
  updateLocalisedStrings_() {
    const currentTitle = this.currentChapterTitle_.value
    const actionLabel = this.overlayOpen_
      ? i18n.global.t('Chapters.Close Chapters')
      : i18n.global.t('Chapters.Open Chapters')

    this.nameSpan_.textContent = i18n.global.t('Chapters.Chapters')
    this.currentState_.textContent = currentTitle
    this.currentTitleSpan_.textContent = currentTitle
    this.button_.ariaLabel = actionLabel
    this.button_.ariaExpanded = String(this.overlayOpen_)
    this.button_.classList.toggle('open', this.overlayOpen_)
  }

  /** @private */
  updateVisibility_() {
    this.button_.classList.toggle('shaka-hidden', !this.chaptersAvailable_.value || this.isSubMenuOpened)
  }

  /** @override */
  checkAvailability() {
    this.updateVisibility_()
  }
}
