import shaka from 'shaka-player'
import { h, render, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'

import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'
import { currentIconPack } from '../../../icons/iconPackState'
import { resolveIconifyId } from '../../../icons/resolveIconifyId'
import { formatDurationAsTimestamp, getRelativeTimeFromDate } from '../../../helpers/utils'
import { scheduleOverflowMenuScrollClamp } from './overflowMenu'

export class SeekHistoryMenu extends shaka.ui.SettingsMenu {
  /**
   * @param {import('vue').Ref<import('../../../helpers/player/seekHistory').SeekHistory>} history
   * @param {import('vue').Ref<{ title: string, startSeconds: number }[]>} chapters
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(history, chapters, events, parent, controls) {
    super(parent, controls)

    /** @private Follows the selected icon pack */
    this.stopIconWatch_ = watch(currentIconPack, () => {
      const svg = this.icon.getSvgElement()
      svg.setAttribute('viewBox', '0 0 24 24')
      render(h(Icon, { icon: resolveIconifyId('history'), width: 24, height: 24 }), svg)
    }, { immediate: true })

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

    // Shaka opens the menu first, so only the text changes under the focus it moves.
    this.eventManager.listen(this.button, 'click', () => {
      this.updateLeftAtLabels_()
    })

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    /** @private */
    this.stopHistoryWatch_ = watch([history, chapters], () => this.updateEntries_())

    this.updateLocalisedStrings_()
  }

  release() {
    this.stopHistoryWatch_()
    this.stopIconWatch_()
    render(null, this.icon.getSvgElement())
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
    const { entries, index } = this.history_.value
    const previousCount = this.menu.querySelectorAll('.seek-history-entry').length

    for (const entry of this.menu.querySelectorAll('.seek-history-entry')) {
      entry.remove()
    }

    // Newest first, as the most recent place is the likeliest to return to.
    for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex--) {
      const { position, leftAt } = entries[entryIndex]
      const button = document.createElement('button')
      button.classList.add('seek-history-entry')
      button.dataset.position = String(position)

      const label = document.createElement('span')
      label.textContent = this.formatPosition_(position)
      button.appendChild(label)

      const leftAtLabel = document.createElement('span')
      leftAtLabel.classList.add('seek-history-left-at')
      leftAtLabel.dataset.leftAt = String(leftAt)
      button.appendChild(leftAtLabel)

      if (entryIndex === index) {
        label.classList.add('shaka-chosen-item')
        button.ariaSelected = 'true'
        button.appendChild(this.checkmarkIcon_)
      }

      this.menu.appendChild(button)
    }

    this.updateLeftAtLabels_()

    const status = i18n.global.t('Video.Player.Seek History.Positions', { count: entries.length }, entries.length)
    this.currentSelection.textContent = status
    this.button.setAttribute('shaka-status', status)

    if (this.isSubMenuOpened && entries.length < previousCount) {
      scheduleOverflowMenuScrollClamp(this.parent, this.menu.lastElementChild)
    }

    this.updateVisibility_()
  }

  /** @private */
  updateLeftAtLabels_() {
    const now = Date.now()
    for (const label of this.menu.querySelectorAll('.seek-history-left-at')) {
      label.textContent = getRelativeTimeFromDate(Number(label.dataset.leftAt), true, true, now)
    }
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
    const hidden = this.history_.value.entries.length === 0 || this.isSubMenuOpened
    this.button.classList.toggle('shaka-hidden', hidden)

    // Only an empty history hides the entry while the menu shows it.
    if (hidden && !wasHidden && !this.isSubMenuOpened) {
      scheduleOverflowMenuScrollClamp(this.parent)
    }
  }

  /** @override */
  checkAvailability() {
    this.updateVisibility_()
  }
}
