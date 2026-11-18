import shaka from 'shaka-player'

import {
  CAPTION_BACKGROUND_OPACITIES,
  CAPTION_BACKGROUND_OPACITY_STEP,
  CAPTION_FONT_SCALE_FACTOR_STEP,
  CAPTION_FONT_SCALE_FACTORS,
  getDefaultBackgroundOpacity,
  MAX_CAPTION_FONT_SCALE_FACTOR,
  MIN_CAPTION_FONT_SCALE_FACTOR,
} from '../../../helpers/player/caption-settings'
import { addSliderMenu, choosePreset, fillSlider } from './sliderMenu'

/**
 * @typedef {{
 *   configName: 'fontScaleFactor' | 'backgroundOpacity',
 *   icon: string,
 *   buttonClass: string,
 *   menuClass: string,
 *   nameId: string,
 *   longNameId: string,
 *   min: number,
 *   max: number,
 *   step: number,
 *   presets: readonly number[],
 *   getDefaultValue?: (config: shaka.extern.TextDisplayerConfiguration) => number,
 * }} CaptionStyleSliderOptions
 * `NaN` in the presets is Shaka's default, which leaves the value to the captions.
 * The slider shows `getDefaultValue` for it.
 */

/**
 * Replaces Shaka's caption style menus that only offer a few fixed values with a slider and presets
 * like its playback speed menu. The slider only applies a value once the drag ends, as every applied
 * value gets saved.
 */
export class CaptionStyleSlider extends shaka.ui.TextStyleMenu {
  /**
   * @param {CaptionStyleSliderOptions} options
   * @param {!HTMLElement} parent
   * @param {!shaka.ui.Controls} controls
   */
  constructor(options, parent, controls) {
    super(parent, controls, options.icon)
    /** @private */
    this.options_ = options

    this.button.classList.add(options.buttonClass, 'shaka-tooltip')
    this.menu.classList.add(options.menuClass)

    const { value, slider, decreaseButton, increaseButton, presetButtons } = addSliderMenu(this, {
      step: options.step,
      presets: options.presets,
      onStep: delta => this.applyValue_(this.normalize_(this.getSliderValue_() + delta)),
      onPreset: preset => this.applyValue_(preset),
    })
    /** @private */
    this.value_ = value
    /** @private */
    this.slider_ = slider
    /** @private */
    this.decreaseButton_ = decreaseButton
    /** @private */
    this.increaseButton_ = increaseButton
    /** @private */
    this.presetButtons_ = presetButtons

    slider.setRange(options.min, options.max)
    slider.onChange = () => this.updateSlider_(slider.getValue(), slider.getValue())
    slider.onChangeEnd = () => this.applyValue_(slider.getValue())
    // The arrow keys change the range natively, which only ends with a change event
    this.eventManager.listen(slider.bar, 'change', () => this.applyValue_(slider.getValue()))
    // Shaka's wheel handling has no end, so it goes through `changeTo` instead, which ends on its own
    this.eventManager.listen(slider.container, 'wheel', (event) => {
      if (event.ctrlKey || event.metaKey) return
      event.preventDefault()
      slider.changeTo(this.normalize_(slider.getValue() + (event.deltaY > 0 ? -options.step : options.step)))
    })

    // After Shaka's listeners, which clear the current value, as its label method is private in Shaka's build
    this.eventManager.listenMulti(
      this.player,
      ['loading', 'unloading', 'configurationchanged', 'trackschanged'],
      () => this.updateSelection_()
    )

    this.updateLocalizedStrings()
    this.checkAvailability()
  }

  /** @override */
  release() {
    this.slider_.release()
    super.release()
  }

  /** @override */
  updateLocalizedStrings() {
    // Called by Shaka's constructors before the slider exists, the constructor calls it again
    if (!this.slider_) return

    this.backButton.ariaLabel = this.localization.resolve('BACK')
    // Inside a menu group, the group already names the context, like Shaka's style menus
    const label = this.localization.resolve(this.isInMenuGroup ? this.options_.nameId : this.options_.longNameId)
    this.button.ariaLabel = label
    this.nameSpan.textContent = label
    this.backSpan.textContent = label
    this.slider_.bar.ariaLabel = label
    for (const button of this.presetButtons_) {
      button.textContent = this.format_(Number(button.dataset.value))
    }
    this.updateSelection_()
  }

  /**
   * @param {number} value
   * @returns {string}
   * @private
   */
  format_(value) {
    return Number.isNaN(value) ? this.localization.resolve('DEFAULT') : `${Math.round(value * 100)}%`
  }

  /**
   * Keeps a value within the range of the slider and snaps it to its step.
   * @param {number} value
   * @returns {number}
   * @private
   */
  normalize_(value) {
    const { min, max, step } = this.options_
    // Removes floating-point noise, such as 1.3 becoming 1.3000000000000003
    const stepped = Number((Math.round(value / step) * step).toFixed(2))
    return Math.min(max, Math.max(min, stepped))
  }

  /**
   * @returns {number}
   * @private
   */
  getValue_() {
    return this.player.getConfiguration().textDisplayer[this.options_.configName]
  }

  /**
   * Where the slider shows the current value, which can be Shaka's default.
   * @returns {number}
   * @private
   */
  getSliderValue_() {
    const value = this.getValue_()
    return Number.isNaN(value) ? this.options_.getDefaultValue(this.player.getConfiguration().textDisplayer) : value
  }

  /**
   * Shows a value on the slider and above it, while it is dragged or applied.
   * @param {number} value
   * @param {number} sliderValue
   * @private
   */
  updateSlider_(value, sliderValue) {
    this.value_.textContent = this.format_(value)
    fillSlider(this.slider_, this.controls, sliderValue)
  }

  /**
   * @param {number} value
   * @private
   */
  applyValue_(value) {
    const normalized = Number.isNaN(value) ? value : this.normalize_(value)
    if (!Object.is(normalized, this.getValue_())) {
      this.player.configure(`textDisplayer.${this.options_.configName}`, normalized)
    }
    this.updateSelection_()
  }

  /** @private */
  updateSelection_() {
    const value = this.getValue_()
    const sliderValue = this.getSliderValue_()
    this.slider_.setValue(sliderValue)
    this.updateSlider_(value, sliderValue)
    this.currentSelection.textContent = this.format_(value)
    this.decreaseButton_.disabled = sliderValue <= this.options_.min
    this.increaseButton_.disabled = sliderValue >= this.options_.max
    choosePreset(this.presetButtons_, value)
  }
}

/** @type {CaptionStyleSliderOptions} */
export const CAPTION_FONT_SIZE_SLIDER = {
  configName: 'fontScaleFactor',
  icon: shaka.ui.Enums.MaterialDesignSVGIcons.CLOSED_CAPTIONS_SIZE,
  buttonClass: 'shaka-caption-size-button',
  menuClass: 'ft-caption-font-sizes',
  nameId: 'FONT_SIZE',
  longNameId: 'SUBTITLE_SIZE',
  min: MIN_CAPTION_FONT_SCALE_FACTOR,
  max: MAX_CAPTION_FONT_SCALE_FACTOR,
  step: CAPTION_FONT_SCALE_FACTOR_STEP,
  presets: CAPTION_FONT_SCALE_FACTORS,
}

/** @type {CaptionStyleSliderOptions} */
export const CAPTION_BACKGROUND_OPACITY_SLIDER = {
  configName: 'backgroundOpacity',
  icon: shaka.ui.Enums.MaterialDesignSVGIcons.CLOSED_CAPTIONS_BACKGROUND_OPACITY,
  buttonClass: 'shaka-caption-background-opacity-button',
  menuClass: 'ft-caption-background-opacities',
  nameId: 'BACKGROUND_OPACITY',
  longNameId: 'SUBTITLE_BACKGROUND_OPACITY',
  min: 0,
  max: 1,
  step: CAPTION_BACKGROUND_OPACITY_STEP,
  presets: CAPTION_BACKGROUND_OPACITIES.map(opacity => opacity ?? Number.NaN),
  getDefaultValue: config => getDefaultBackgroundOpacity(config.backgroundColor),
}
