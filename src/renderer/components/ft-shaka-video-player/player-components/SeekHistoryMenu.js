import shaka from 'shaka-player'
import { watch } from 'vue'

import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'
import { formatDurationAsTimestamp } from '../../../helpers/utils'
import { scheduleOverflowMenuScrollClamp } from './overflowMenu'

export const SEEK_HISTORY_ICON = Object.freeze({
  path: 'M12 21q-3.15 0-5.575-1.912T3.275 14.2q-.1-.375.15-.687t.675-.363q.4-.05.725.15t.45.6q.6 2.25 2.475 3.675T12 19q2.925 0 4.963-2.037T19 12t-2.037-4.962T12 5q-1.725 0-3.225.8T6.25 8H8q.425 0 .713.288T9 9t-.288.713T8 10H4q-.425 0-.712-.288T3 9V5q0-.425.288-.712T4 4t.713.288T5 5v1.35q1.275-1.6 3.113-2.475T12 3q1.875 0 3.513.713t2.85 1.924t1.925 2.85T21 12t-.712 3.513t-1.925 2.85t-2.85 1.925T12 21m1-9.4l2.5 2.5q.275.275.275.7t-.275.7t-.7.275t-.7-.275l-2.8-2.8q-.15-.15-.225-.337T11 11.975V8q0-.425.288-.712T12 7t.713.288T13 8z',
  viewBox: '0 0 24 24',
})

export class SeekHistoryMenu extends shaka.ui.SettingsMenu {
  /**
   * @param {import('vue').Ref<import('../../../helpers/player/seekHistory').SeekHistory>} history
   * @param {import('vue').Ref<{ title: string, startSeconds: number }[]>} chapters
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(history, chapters, events, parent, controls) {
    super(parent, controls, SEEK_HISTORY_ICON)

    this.button.classList.add('seek-history-button', 'shaka-tooltip-status')
    this.menu.classList.add('seek-history-menu')

    /** @private */
    this.history_ = history
    /** @private */
    this.chapters_ = chapters
    /** @private */
    this.events_ = events

    /** @type {SVGElement} */
    const checkmarkIcon = new shaka.ui.Icon(null, PlayerIcons.DONE_FILLED).getSvgElement()
    checkmarkIcon.classList.add('shaka-chosen-item')
    checkmarkIcon.ariaHidden = 'true'

    /** @private */
    this.checkmarkIcon_ = checkmarkIcon

    this.eventManager.listen(this.menu, 'click', (/** @type {MouseEvent} */ event) => {
      const entry = /** @type {HTMLElement} */ (event.target).closest('.seek-history-entry')
      if (entry) {
        this.events_.dispatchEvent(new CustomEvent('seekHistorySelect', { detail: Number(entry.dataset.position) }))
      }
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
    this.stopHistoryWatch_ = watch([history, chapters], () => this.updateEntries_())

    this.updateLocalisedStrings_()
  }

  release() {
    this.stopHistoryWatch_()
    super.release()
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = i18n.global.t('Video.Player.Seek History.Seek History')
    this.button.ariaLabel = label
    this.nameSpan.textContent = label
    this.backSpan.textContent = label
    this.backButton.ariaLabel = this.localization.resolve('BACK')

    this.updateEntries_()
  }

  /** @private */
  updateEntries_() {
    const { positions, index } = this.history_.value
    const previousCount = this.menu.querySelectorAll('.seek-history-entry').length

    for (const entry of this.menu.querySelectorAll('.seek-history-entry')) {
      entry.remove()
    }

    // Newest first, as the most recent place is the likeliest to return to.
    for (let entryIndex = positions.length - 1; entryIndex >= 0; entryIndex--) {
      const position = positions[entryIndex]
      const button = document.createElement('button')
      button.classList.add('seek-history-entry')
      button.dataset.position = String(position)

      const label = document.createElement('span')
      label.textContent = this.formatPosition_(position)
      button.appendChild(label)

      if (entryIndex === index) {
        label.classList.add('shaka-chosen-item')
        button.ariaSelected = 'true'
        button.appendChild(this.checkmarkIcon_)
      }

      this.menu.appendChild(button)
    }

    const status = i18n.global.t('Video.Player.Seek History.Positions', { count: positions.length }, positions.length)
    this.currentSelection.textContent = status
    this.button.setAttribute('shaka-status', status)

    if (this.isSubMenuOpened && positions.length < previousCount) {
      scheduleOverflowMenuScrollClamp(this.parent, this.menu.lastElementChild)
    }

    this.updateVisibility_()
  }

  /**
   * @param {number} position
   * @returns {string}
   * @private
   */
  formatPosition_(position) {
    const timestamp = formatDurationAsTimestamp(position)
    const chapter = this.chapters_.value.findLast(({ startSeconds }) => startSeconds <= position)
    return chapter?.title ? `${timestamp} · ${chapter.title}` : timestamp
  }

  /** @private */
  updateVisibility_() {
    const wasHidden = this.button.classList.contains('shaka-hidden')
    const hidden = this.history_.value.positions.length === 0 || this.isSubMenuOpened
    this.button.classList.toggle('shaka-hidden', hidden)

    // Only an empty history hides the entry while the menu shows it.
    if (hidden && !wasHidden && !this.isSubMenuOpened) {
      scheduleOverflowMenuScrollClamp(this.parent)
    }
  }
}
