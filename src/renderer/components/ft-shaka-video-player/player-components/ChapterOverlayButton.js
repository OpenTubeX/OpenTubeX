import shaka from 'shaka-player'
import { watch } from 'vue'

import i18n from '../../../i18n/index'

export class ChapterOverlayButton extends shaka.ui.Element {
  /**
   * @param {import('vue').ComputedRef<string>} currentChapterTitle
   * @param {boolean} overlayOpen
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(currentChapterTitle, overlayOpen, events, parent, controls) {
    super(parent, controls)

    /** @private */
    this.currentChapterTitle_ = currentChapterTitle

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

    if (this.isSubMenu) {
      this.eventManager.listen(this.controls, 'submenuopen', () => {
        this.updateVisibility_()
      })

      this.eventManager.listen(this.controls, 'submenuclose', () => {
        this.updateVisibility_()
      })
    }

    /** @private */
    this.stopCurrentChapterTitleWatch_ = watch(this.currentChapterTitle_, () => {
      this.updateLocalisedStrings_()
    })

    this.updateLocalisedStrings_()
  }

  release() {
    this.stopCurrentChapterTitleWatch_()
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
    this.button_.classList.toggle('shaka-hidden', this.isSubMenuOpened)
  }
}
