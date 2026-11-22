import shaka from 'shaka-player'
import { h, render, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'

import { currentIconPack } from '../../../icons/iconPackState'
import { resolveIconifyId } from '../../../icons/resolveIconifyId'
import { addSliderMenu, choosePreset, fillSlider } from './sliderMenu'

/**
 * A settings submenu that picks a level, such as zoom or volume boost, with a
 * slider or one of a few presets, like Shaka's playback speed menu. Its entry
 * is highlighted while a level other than the default is selected.
 */
export class LevelSelection extends shaka.ui.SettingsMenu {
  /**
   * @param {{
   *   value: import('vue').ComputedRef<number>,
   *   updateValue: (value: number) => void,
   *   levels: readonly number[],
   *   step: number,
   *   defaultLevel: number,
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
  constructor({ value, updateValue, levels, step, defaultLevel, formatLevel, getLabel, icon, mappedIcon, className }, events, parent, controls) {
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
    this.level_ = value

    /** @private */
    this.min_ = levels[0]

    /** @private */
    this.max_ = levels.at(-1)

    /** @private */
    this.step_ = step

    /** @private */
    this.defaultLevel_ = defaultLevel

    /** @private */
    this.formatLevel_ = formatLevel

    /** @private */
    this.getLabel_ = getLabel

    const { value: valueLabel, slider, decreaseButton, increaseButton, presetButtons } = addSliderMenu(this, {
      step,
      presets: levels,
      onStep: delta => updateValue(this.normalize_(this.level_.value + delta)),
      onPreset: updateValue,
      enableWheel: true,
    })

    /** @private */
    this.valueLabel_ = valueLabel

    /** @private */
    this.slider_ = slider

    /** @private */
    this.decreaseButton_ = decreaseButton

    /** @private */
    this.increaseButton_ = increaseButton

    /** @private */
    this.presetButtons_ = presetButtons

    // Levels are only kept for the session, so they apply while the slider moves.
    // Releasing the mouse can move the slider once more and only ends the change.
    // The wheel can leave a level past the largest one as it is, which would clamp it.
    slider.onChange = slider.onChangeEnd = () => {
      if (slider.getValue() !== this.level_.value) updateValue(this.normalize_(slider.getValue()))
    }

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    /** @private */
    this.stopValueWatch_ = watch(this.level_, () => {
      this.updateState_()
    })

    this.updateLocalisedStrings_()
  }

  release() {
    this.stopValueWatch_()
    if (this.stopIconWatch_) {
      this.stopIconWatch_()
      render(null, this.icon.getSvgElement())
    }
    this.slider_.release()
    super.release()
  }

  /**
   * Keeps a value within the range of the slider and snaps it to its step.
   * @param {number} value
   * @returns {number}
   * @private
   */
  normalize_(value) {
    // Removes floating-point noise, such as 1.3 becoming 1.3000000000000003
    const stepped = Number((Math.round(value / this.step_) * this.step_).toFixed(2))
    return Math.min(this.max_, Math.max(this.min_, stepped))
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = this.getLabel_()

    this.button.ariaLabel = label
    this.nameSpan.textContent = label
    this.backSpan.textContent = label
    this.backButton.ariaLabel = this.localization.resolve('BACK')
    this.slider_.bar.ariaLabel = label

    for (const button of this.presetButtons_) {
      button.textContent = this.formatLevel_(Number(button.dataset.value))
    }

    this.updateState_()
  }

  /** @private */
  updateState_() {
    const currentLevel = this.level_.value
    const status = this.formatLevel_(currentLevel)

    // A pinch can zoom past the largest level, which the slider then reaches to show it
    this.slider_.setRange(Math.min(this.min_, currentLevel), Math.max(this.max_, currentLevel))
    this.slider_.setValue(currentLevel)
    fillSlider(this.slider_, this.controls)
    this.valueLabel_.textContent = status
    this.decreaseButton_.disabled = currentLevel <= this.min_
    this.increaseButton_.disabled = currentLevel >= this.max_
    choosePreset(this.presetButtons_, currentLevel)

    this.currentSelection.textContent = status
    this.button.setAttribute('shaka-status', status)
    this.button.classList.toggle('ft-active', currentLevel !== this.defaultLevel_)
  }
}
