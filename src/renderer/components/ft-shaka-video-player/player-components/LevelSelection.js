import shaka from 'shaka-player'
import { h, render, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'

import { PlayerIcons } from '../../../../constants'
import { currentIconPack } from '../../../icons/iconPackState'
import { resolveIconifyId } from '../../../icons/resolveIconifyId'

/**
 * A settings submenu that picks one of a few preset levels, such as zoom or
 * volume boost.
 */
export class LevelSelection extends shaka.ui.SettingsMenu {
  /**
   * @param {{
   *   value: import('vue').ComputedRef<number>,
   *   updateValue: (value: number) => void,
   *   levels: readonly number[],
   *   formatLevel: (value: number) => string,
   *   getLabel: () => string,
   *   icon?: string | { path: string, viewBox: string },
   *   mappedIcon?: string,
   *   className: string
   * }} options
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor({ value, updateValue, levels, formatLevel, getLabel, icon, mappedIcon, className }, events, parent, controls) {
    super(parent, controls, icon)

    /** @private Follows the selected icon pack */
    this.stopIconWatch_ = mappedIcon && watch(currentIconPack, () => {
      const svg = this.icon.getSvgElement()
      svg.setAttribute('viewBox', '0 0 24 24')
      render(h(Icon, { icon: resolveIconifyId(mappedIcon), width: 24, height: 24 }), svg)
    }, { immediate: true })

    this.button.classList.add(`${className}-button`, 'shaka-tooltip-status')
    this.menu.classList.add(`${className}-menu`)

    /** @private */
    this.value_ = value

    /** @private */
    this.formatLevel_ = formatLevel

    /** @private */
    this.getLabel_ = getLabel

    /** @type {SVGElement} */
    const checkmarkIcon = new shaka.ui.Icon(null, PlayerIcons.DONE_FILLED).getSvgElement()
    checkmarkIcon.classList.add('shaka-chosen-item')
    checkmarkIcon.ariaHidden = 'true'

    /** @private */
    this.checkmarkIcon_ = checkmarkIcon

    /** @private @type {Map<number, HTMLButtonElement>} */
    this.levelButtons_ = new Map()

    for (const level of levels) {
      const button = document.createElement('button')
      button.appendChild(document.createElement('span'))
      this.menu.appendChild(button)

      this.eventManager.listen(button, 'click', () => {
        updateValue(level)
      })

      this.levelButtons_.set(level, button)
    }

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    if (this.isSubMenu) {
      this.eventManager.listen(this.controls, 'submenuopen', () => {
        this.button.classList.add('shaka-hidden')
      })
      this.eventManager.listen(this.controls, 'submenuclose', () => {
        this.button.classList.remove('shaka-hidden')
      })
    }

    /** @private */
    this.stopValueWatch_ = watch(this.value_, () => {
      this.updateState_()
    })

    this.updateLocalisedStrings_()
    this.updateState_()
  }

  release() {
    this.stopValueWatch_()
    if (this.stopIconWatch_) {
      this.stopIconWatch_()
      render(null, this.icon.getSvgElement())
    }
    super.release()
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = this.getLabel_()

    this.button.ariaLabel = label
    this.nameSpan.textContent = label
    this.backSpan.textContent = label
    this.backButton.ariaLabel = this.localization.resolve('BACK')

    for (const [level, button] of this.levelButtons_) {
      button.querySelector('span').textContent = this.formatLevel_(level)
    }

    this.updateState_()
  }

  /** @private */
  updateState_() {
    const currentLevel = this.value_.value

    for (const [level, button] of this.levelButtons_) {
      const isSelected = level === currentLevel

      button.querySelector('span').classList.toggle('shaka-chosen-item', isSelected)
      button.ariaSelected = isSelected ? 'true' : 'false'

      if (isSelected) {
        button.appendChild(this.checkmarkIcon_)
      }
    }

    const status = this.formatLevel_(currentLevel)

    this.currentSelection.textContent = status
    this.button.setAttribute('shaka-status', status)
  }
}
