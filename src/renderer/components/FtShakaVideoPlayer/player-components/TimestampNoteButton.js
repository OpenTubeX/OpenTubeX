import shaka from 'shaka-player'

import i18n from '../../../i18n/index'
import { KeyboardShortcuts, PlayerIcons } from '../../../../constants'
import { addKeyboardShortcutToActionTitle } from '../../../helpers/utils'

export class TimestampNoteButton extends shaka.ui.Element {
  /**
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(events, parent, controls) {
    super(parent, controls)

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('timestamp-note-button', 'shaka-tooltip')

    // eslint-disable-next-line no-new
    new shaka.ui.Icon(this.button_, PlayerIcons.EDIT_NOTE_DEFAULT)

    const label = document.createElement('label')
    label.classList.add(
      'shaka-overflow-button-label',
      'shaka-overflow-menu-only',
      'shaka-simple-overflow-button-label-inline'
    )

    /** @private */
    this.nameSpan_ = document.createElement('span')
    label.appendChild(this.nameSpan_)

    this.button_.appendChild(label)

    this.parent.appendChild(this.button_)

    // listeners

    this.eventManager.listen(this.button_, 'click', () => {
      events.dispatchEvent(new CustomEvent('takeTimestampNote'))
    })

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    this.updateLocalisedStrings_()
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = addKeyboardShortcutToActionTitle(
      i18n.global.t('Video.Player.Timestamp Notes.Take Note'),
      KeyboardShortcuts.VIDEO_PLAYER.GENERAL.TAKE_TIMESTAMP_NOTE
    )
    this.nameSpan_.textContent = this.button_.ariaLabel = label
  }

  /** @override */
  checkAvailability() {
    if (this.isSubMenuOpened) {
      this.button_.classList.add('shaka-hidden')
    } else {
      this.button_.classList.remove('shaka-hidden')
    }
  }
}
