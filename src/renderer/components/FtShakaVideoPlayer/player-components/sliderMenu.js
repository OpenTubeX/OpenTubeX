import shaka from 'shaka-player'

/**
 * Adds a slider with step buttons and preset buttons below it to a settings menu, using the classes
 * of Shaka's playback speed menu, which style them.
 * @param {shaka.ui.SettingsMenu} settingsMenu
 * @param {{
 *   step: number,
 *   presets: readonly number[],
 *   onStep: (delta: number) => void,
 *   onPreset: (value: number) => void,
 *   enableWheel?: boolean,
 * }} options
 */
export function addSliderMenu(settingsMenu, { step, presets, onStep, onPreset, enableWheel = false }) {
  const { controls, eventManager, menu } = settingsMenu
  menu.classList.add('ft-slider-menu')

  const sliderSection = document.createElement('div')
  sliderSection.classList.add('shaka-playback-rate-slider-section')
  const value = document.createElement('div')
  value.classList.add('shaka-playback-rate-value')
  const sliderRow = document.createElement('div')
  sliderRow.classList.add('shaka-playback-rate-slider-row')
  sliderSection.append(value, sliderRow)

  /**
   * @param {string} label
   * @param {number} delta
   */
  const createStepButton = (label, delta) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.classList.add('shaka-playback-rate-step-btn', 'shaka-no-propagation')
    button.ariaLabel = label
    button.textContent = label
    eventManager.listen(button, 'click', () => onStep(delta))
    sliderRow.appendChild(button)
    return button
  }

  const decreaseButton = createStepButton('−', -step)
  const slider = new shaka.ui.RangeElement(
    sliderRow,
    controls,
    ['shaka-playback-rate-slider-container', 'shaka-no-propagation'],
    ['shaka-playback-rate-slider'],
    enableWheel
  )
  slider.setStep(step)
  const increaseButton = createStepButton('+', step)

  const presetsRow = document.createElement('div')
  presetsRow.classList.add('shaka-playback-rate-presets')
  const presetButtons = presets.map((preset) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.classList.add('shaka-playback-rate-preset-btn')
    button.setAttribute('role', 'menuitemradio')
    button.dataset.value = String(preset)
    eventManager.listen(button, 'click', () => onPreset(preset))
    presetsRow.appendChild(button)
    return button
  })

  menu.append(sliderSection, presetsRow)

  return { value, slider, decreaseButton, increaseButton, presetButtons }
}

/**
 * Fills the slider's track up to its thumb, like Shaka's playback speed slider.
 * @param {shaka.ui.RangeElement} slider
 * @param {shaka.ui.Controls} controls
 * @param {number} [value] where to fill to, the slider's value by default
 */
export function fillSlider(slider, controls, value = slider.getValue()) {
  const min = slider.getMin()
  const percent = (value - min) / (slider.getMax() - min) * 100
  const { base, level } = controls.getConfig().playbackRateBarColors
  slider.setBackground(`linear-gradient(to right, ${level} 0%, ${level} ${percent}%, ${base} ${percent}%, ${base} 100%)`)
}

/**
 * Highlights the preset button for the value, if there is one.
 * @param {HTMLButtonElement[]} presetButtons
 * @param {number} value
 */
export function choosePreset(presetButtons, value) {
  for (const button of presetButtons) {
    const chosen = Object.is(Number(button.dataset.value), value)
    button.ariaChecked = String(chosen)
    button.classList.toggle('shaka-chosen-item', chosen)
  }
}
