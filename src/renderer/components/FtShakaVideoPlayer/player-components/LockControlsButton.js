import shaka from 'shaka-player'
import { h, render, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'

import i18n from '../../../i18n/index'
import { currentIconPack } from '../../../icons/iconPackState'
import { resolveIconifyId } from '../../../icons/resolveIconifyId'

/**
 * Locks the touch controls of a full screen player from the overflow menu.
 */
export class LockControlsButton extends shaka.ui.Element {
  /**
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   * @param {() => boolean} isAvailable Checked whenever the menu opens
   */
  constructor(events, parent, controls, isAvailable) {
    super(parent, controls)

    /** @private */
    this.isAvailable_ = isAvailable

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('lock-controls-button', 'shaka-no-propagation')

    /** @private */
    this.icon_ = new shaka.ui.Icon(this.button_)
    const svg = this.icon_.getSvgElement()
    svg.setAttribute('aria-hidden', 'true')
    /** @private */
    this.stopIconWatch_ = watch(currentIconPack, () => {
      svg.setAttribute('viewBox', '0 0 24 24')
      render(h(Icon, { icon: resolveIconifyId('lock'), width: 24, height: 24 }), svg)
    }, { immediate: true })

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

    this.eventManager.listen(this.button_, 'click', () => {
      this.controls.hideSettingsMenus()
      events.dispatchEvent(new Event('lockTouchControls'))
    })
    this.eventManager.listen(events, 'localeChanged', () => this.updateLocalisedStrings_())

    this.updateLocalisedStrings_()
    this.updateVisibility_()
  }

  release() {
    this.stopIconWatch_()
    render(null, this.icon_.getSvgElement())
    super.release()
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = i18n.global.t('Video.Player.Lock Controls.Lock Controls')
    this.nameSpan_.textContent = this.button_.ariaLabel = label
  }

  /** @private */
  updateVisibility_() {
    // Shaka focuses the first entry without shaka-hidden when the menu opens.
    this.button_.classList.toggle('shaka-hidden', this.isSubMenuOpened || !this.isAvailable_())
  }

  /** @override */
  checkAvailability() {
    this.updateVisibility_()
  }
}
