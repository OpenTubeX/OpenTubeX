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
    this.menu.classList.add('ft-caption-style-slider-menu', options.menuClass)

    // Shaka's playback speed classes, which style the slider and the presets
    const sliderSection = document.createElement('div')
    sliderSection.classList.add('shaka-playback-rate-slider-section')
    /** @private */
    this.value_ = document.createElement('div')
    this.value_.classList.add('shaka-playback-rate-value')
    const sliderRow = document.createElement('div')
    sliderRow.classList.add('shaka-playback-rate-slider-row')
    sliderSection.append(this.value_, sliderRow)

    /** @private */
    this.decreaseButton_ = this.createStepButton_(sliderRow, '−', -options.step)
    /** @private */
    this.slider_ = new shaka.ui.RangeElement(
      sliderRow,
      controls,
      ['shaka-playback-rate-slider-container', 'shaka-no-propagation'],
      ['shaka-playback-rate-slider', 'ft-caption-style-slider']
    )
    this.slider_.setRange(options.min, options.max)
    this.slider_.setStep(options.step)
    this.slider_.onChange = () => this.updateSlider_(this.slider_.getValue(), this.slider_.getValue())
    this.slider_.onChangeEnd = () => this.applyValue_(this.slider_.getValue())
    // The arrow keys change the range natively, which only ends with a change event
    this.eventManager.listen(this.slider_.bar, 'change', () => this.applyValue_(this.slider_.getValue()))
    // Shaka's wheel handling has no end, so it goes through `changeTo` instead, which ends on its own
    this.eventManager.listen(this.slider_.container, 'wheel', (event) => {
      if (event.ctrlKey || event.metaKey) return
      event.preventDefault()
      this.slider_.changeTo(this.normalize_(this.slider_.getValue() + (event.deltaY > 0 ? -options.step : options.step)))
    })
    /** @private */
    this.increaseButton_ = this.createStepButton_(sliderRow, '+', options.step)

    const presets = document.createElement('div')
    presets.classList.add('shaka-playback-rate-presets')
    /** @private @type {HTMLButtonElement[]} */
    this.presetButtons_ = options.presets.map((value) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.classList.add('shaka-playback-rate-preset-btn')
      button.setAttribute('role', 'menuitemradio')
      button.dataset.value = String(value)
      this.eventManager.listen(button, 'click', () => this.applyValue_(value))
      presets.appendChild(button)
      return button
    })

    this.menu.append(sliderSection, presets)

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
   * @param {HTMLElement} parent
   * @param {string} label
   * @param {number} delta
   * @returns {HTMLButtonElement}
   * @private
   */
  createStepButton_(parent, label, delta) {
    const button = document.createElement('button')
    button.type = 'button'
    button.classList.add('shaka-playback-rate-step-btn', 'shaka-no-propagation')
    button.ariaLabel = label
    button.textContent = label
    this.eventManager.listen(button, 'click', () => {
      this.applyValue_(this.normalize_(this.getSliderValue_() + delta))
    })
    parent.appendChild(button)
    return button
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
    const { min, max } = this.options_
    this.value_.textContent = this.format_(value)
    const percent = (sliderValue - min) / (max - min) * 100
    const { base, level } = this.controls.getConfig().playbackRateBarColors
    this.slider_.setBackground(`linear-gradient(to right, ${level} 0%, ${level} ${percent}%, ${base} ${percent}%, ${base} 100%)`)
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
    for (const button of this.presetButtons_) {
      const chosen = Object.is(Number(button.dataset.value), value)
      button.ariaChecked = String(chosen)
      button.classList.toggle('shaka-chosen-item', chosen)
    }
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
