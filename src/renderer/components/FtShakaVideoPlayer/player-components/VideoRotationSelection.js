import shaka from 'shaka-player'
import { h, render, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'

import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'
import { currentIconPack } from '../../../icons/iconPackState'
import { resolveIconifyId } from '../../../icons/resolveIconifyId'
import { VIDEO_ROTATIONS } from '../../../helpers/player/videoRotation'

/** @type {Record<number, () => string>} */
const ROTATION_LABELS = {
  0: () => i18n.global.t('Video.Player.Rotate Video.Off'),
  90: () => i18n.global.t('Video.Player.Rotate Video.Right'),
  180: () => i18n.global.t('Video.Player.Rotate Video.Upside Down'),
  270: () => i18n.global.t('Video.Player.Rotate Video.Left'),
}

/**
 * A settings submenu that turns the video by a quarter, a half, or back. Its
 * entry is highlighted while the video is turned.
 */
export class VideoRotationSelection extends shaka.ui.SettingsMenu {
  /**
   * @param {{
   *   value: import('vue').ComputedRef<number>,
   *   updateValue: (value: number) => void,
   *   events: EventTarget,
   * }} options
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor({ value, updateValue, events }, parent, controls) {
    super(parent, controls)

    /** @private Follows the selected icon pack */
    this.stopIconWatch_ = watch(currentIconPack, () => {
      const svg = this.icon.getSvgElement()
      svg.setAttribute('viewBox', '0 0 24 24')
      render(h(Icon, { icon: resolveIconifyId('rotate-right'), width: 24, height: 24 }), svg)
    }, { immediate: true })

    this.button.classList.add('rotate-video-button', 'shaka-tooltip-status')
    this.menu.classList.add('rotate-video-menu')

    /** @private */
    this.rotation_ = value

    /** @type {SVGElement} */
    const checkmarkIcon = new shaka.ui.Icon(null, PlayerIcons.DONE_FILLED).getSvgElement()
    checkmarkIcon.classList.add('shaka-chosen-item')
    checkmarkIcon.ariaHidden = 'true'

    /** @private */
    this.checkmarkIcon_ = checkmarkIcon

    /** @private @type {Map<number, HTMLButtonElement>} */
    this.optionButtons_ = new Map()

    for (const rotation of VIDEO_ROTATIONS) {
      const button = document.createElement('button')
      button.role = 'menuitemradio'
      button.ariaChecked = 'false'
      button.appendChild(document.createElement('span'))
      this.eventManager.listen(button, 'click', () => updateValue(rotation))
      this.menu.appendChild(button)
      this.optionButtons_.set(rotation, button)
    }

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    /** @private */
    this.stopValueWatch_ = watch(this.rotation_, () => {
      this.updateSelection_()
    })

    this.updateLocalisedStrings_()
  }

  release() {
    this.stopValueWatch_()
    this.stopIconWatch_()
    render(null, this.icon.getSvgElement())
    super.release()
  }

  /** @override */
  checkAvailability() {
    this.button.classList.toggle('shaka-hidden', this.isSubMenuOpened)
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = i18n.global.t('Video.Player.Rotate Video.Rotate Video')

    this.button.ariaLabel = label
    this.nameSpan.textContent = label
    this.backSpan.textContent = label
    this.backButton.ariaLabel = this.localization.resolve('BACK')

    for (const [rotation, button] of this.optionButtons_) {
      button.querySelector('span').textContent = ROTATION_LABELS[rotation]()
    }

    this.updateSelection_()
  }

  /** @private */
  updateSelection_() {
    const rotation = this.rotation_.value

    for (const [optionRotation, button] of this.optionButtons_) {
      const selected = optionRotation === rotation
      button.ariaChecked = String(selected)
      button.querySelector('span').classList.toggle('shaka-chosen-item', selected)
      if (selected) {
        button.appendChild(this.checkmarkIcon_)
        // Only while the menu is visible, so that updates elsewhere don't pull focus into it.
        if (button.offsetParent !== null) button.focus()
      }
    }

    const status = ROTATION_LABELS[rotation]()
    this.currentSelection.textContent = status
    this.button.setAttribute('shaka-status', status)
    this.button.classList.toggle('ft-active', rotation !== 0)
  }
}
