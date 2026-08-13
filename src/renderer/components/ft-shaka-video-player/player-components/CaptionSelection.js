import shaka from 'shaka-player'

import i18n from '../../../i18n/index'
import {
  addOverlayScrollbars,
  removeOverlayScrollbars,
  restoreOverlayScrollTop,
} from '../../../helpers/overlayScrollbars'
import {
  CAPTION_ANCHORS,
  CAPTION_EDGE_STYLES,
  DEFAULT_CAPTION_SETTINGS,
  MAX_CAPTION_FONT_SCALE,
  MIN_CAPTION_FONT_SCALE,
} from '../../../helpers/player/caption-settings'

const CAPTION_COLOR_PALETTE = Object.freeze([
  '#ffffff', '#d9d9d9', '#808080', '#000000',
  '#ffeb3b', '#ff9800', '#f44336', '#e91e63',
  '#9c27b0', '#3f51b5', '#03a9f4', '#00bcd4',
  '#009688', '#4caf50', '#8bc34a', '#795548',
])
const HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i

export class CaptionSelection extends shaka.ui.TextSelection {
  /**
   * @param {EventTarget} events
   * @param {() => ReturnType<import('../../../helpers/player/caption-settings').parseCaptionSettings>} getSettings
   * @param {(setting: string, value: string | number) => void} updateSetting
   * @param {() => void} resetSettings
   * @param {() => {id: string, url: string, label: string, translationName: string, language: string, mimeType: string}[]} getTranslations
   * @param {(caption: {url: string, label: string, language: string, mimeType: string}) => Promise<boolean>} selectTranslation
   * @param {!HTMLElement} parent
   * @param {!shaka.ui.Controls} controls
   */
  constructor(events, getSettings, updateSetting, resetSettings, getTranslations, selectTranslation, parent, controls) {
    super(parent, controls)

    this.getSettings_ = getSettings
    this.updateSetting_ = updateSetting
    this.resetSettings_ = resetSettings
    this.getTranslations_ = getTranslations
    this.selectTranslation_ = selectTranslation
    this.openColorControl_ = null

    this.optionsButton_ = document.createElement('button')
    this.optionsButton_.type = 'button'
    this.optionsButton_.classList.add('ft-caption-options-button')

    this.autoTranslateButton_ = document.createElement('button')
    this.autoTranslateButton_.type = 'button'
    this.autoTranslateButton_.classList.add('ft-caption-auto-translate-button')
    this.autoTranslateLabel_ = document.createElement('span')
    this.autoTranslateButton_.appendChild(this.autoTranslateLabel_)

    this.translationMenu_ = document.createElement('div')
    this.translationMenu_.classList.add(
      'shaka-no-propagation',
      'shaka-show-controls-on-mouse-over',
      'shaka-hidden',
      'ft-caption-translation-menu',
      this.isSubMenu ? 'shaka-sub-menu' : 'shaka-settings-menu'
    )
    const translationMenuParent = this.isSubMenu ? parent : controls.getControlsContainer()
    translationMenuParent.appendChild(this.translationMenu_)

    this.translationBackButton_ = document.createElement('button')
    this.translationBackButton_.classList.add('shaka-back-to-overflow-button')
    this.translationMenu_.appendChild(this.translationBackButton_)
    this.translationBackIcon_ = new shaka.ui.Icon(
      this.translationBackButton_,
      shaka.ui.Enums.MaterialDesignSVGIcons.BACK
    )
    this.translationBackLabel_ = document.createElement('span')
    this.translationBackButton_.appendChild(this.translationBackLabel_)
    this.translationOptions_ = document.createElement('div')
    this.translationOptions_.classList.add('ft-caption-translation-options')
    this.translationMenu_.appendChild(this.translationOptions_)
    this.translationSignature_ = ''

    this.appearanceMenu_ = document.createElement('div')
    this.appearanceMenu_.classList.add(
      'shaka-no-propagation',
      'shaka-show-controls-on-mouse-over',
      'shaka-hidden',
      'ft-caption-appearance-menu',
      this.isSubMenu ? 'shaka-sub-menu' : 'shaka-settings-menu'
    )
    const appearanceMenuParent = this.isSubMenu ? parent : controls.getControlsContainer()
    appearanceMenuParent.appendChild(this.appearanceMenu_)

    this.appearanceBackButton_ = document.createElement('button')
    this.appearanceBackButton_.classList.add('shaka-back-to-overflow-button')
    this.appearanceMenu_.appendChild(this.appearanceBackButton_)
    this.appearanceBackIcon_ = new shaka.ui.Icon(
      this.appearanceBackButton_,
      shaka.ui.Enums.MaterialDesignSVGIcons.BACK
    )
    this.appearanceBackLabel_ = document.createElement('span')
    this.appearanceBackButton_.appendChild(this.appearanceBackLabel_)

    this.appearanceControls_ = document.createElement('div')
    this.appearanceControls_.classList.add('ft-caption-appearance-controls')
    this.appearanceMenu_.appendChild(this.appearanceControls_)

    this.textColor_ = this.createColorControl_('textColor')
    this.backgroundColor_ = this.createColorControl_('backgroundColor')
    this.backgroundOpacity_ = this.createRangeControl_('backgroundOpacity', 0, 1, 0.05)
    this.fontScale_ = this.createRangeControl_('fontScale', MIN_CAPTION_FONT_SCALE, MAX_CAPTION_FONT_SCALE, 0.1)
    this.anchor_ = this.createAnchorControl_()
    this.verticalPosition_ = this.createRangeControl_('verticalPosition', 0, 0.5, 0.01)
    this.edgeStyle_ = this.createEdgeStyleControl_()
    this.edgeColor_ = this.createColorControl_('edgeColor')

    this.resetButton_ = document.createElement('button')
    this.resetButton_.type = 'button'
    this.resetButton_.classList.add('ft-caption-appearance-reset')
    this.appearanceMenu_.appendChild(this.resetButton_)

    this.eventManager.listen(this.optionsButton_, 'click', (event) => {
      event.stopPropagation()
      this.closeColorPopover_()
      this.updateAppearanceControls_(this.getSettings_())
      this.setMenuDisplay_(this.menu, false)
      this.setMenuDisplay_(this.appearanceMenu_, true)
      this.appearanceBackButton_.focus()
    })

    this.eventManager.listen(this.autoTranslateButton_, 'click', (event) => {
      event.stopPropagation()
      this.setMenuDisplay_(this.menu, false)
      this.setMenuDisplay_(this.translationMenu_, true)
      this.translationBackButton_.focus({ preventScroll: true })
      requestAnimationFrame(() => {
        addOverlayScrollbars(this.translationOptions_)
        restoreOverlayScrollTop(this.translationOptions_, 0)
      })
    })

    this.eventManager.listen(this.translationBackButton_, 'click', () => {
      this.setMenuDisplay_(this.translationMenu_, false)
      this.setMenuDisplay_(this.menu, true)
      this.autoTranslateButton_.focus({ preventScroll: true })
      this.resetMenuScroll_(this.menu.parentElement)
    })

    this.eventManager.listen(this.appearanceBackButton_, 'click', () => {
      this.closeColorPopover_()
      this.setMenuDisplay_(this.appearanceMenu_, false)
      this.setMenuDisplay_(this.menu, true)
      this.optionsButton_.focus()
    })

    this.eventManager.listen(this.resetButton_, 'click', () => {
      this.closeColorPopover_()
      this.resetSettings_()
      this.updateAppearanceControls_(DEFAULT_CAPTION_SETTINGS)
    })

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    // Shaka rebuilds the language menu whenever tracks or caption state change.
    this.eventManager.listen(this.controls, 'captionselectionupdated', () => {
      this.addCaptionActions_()
    })

    this.eventManager.listen(this.controls, 'submenuclose', () => {
      this.closeColorPopover_()
      this.setMenuDisplay_(this.appearanceMenu_, false)
      this.setMenuDisplay_(this.translationMenu_, false)
    })

    this.updateLocalisedStrings_()
    this.updateAppearanceControls_(this.getSettings_())
    this.addCaptionActions_()
  }

  release() {
    removeOverlayScrollbars(this.translationOptions_)
    this.translationMenu_.remove()
    this.appearanceMenu_.remove()
    super.release()
  }

  /**
   * @param {'textColor' | 'backgroundColor' | 'edgeColor'} setting
   * @returns {{container: HTMLDivElement, label: HTMLSpanElement, swatchButton: HTMLButtonElement, popover: HTMLDivElement, customColorLabel: HTMLSpanElement, customColorInput: HTMLInputElement}}
   * @private
   */
  createColorControl_(setting) {
    const row = document.createElement('div')
    row.classList.add('ft-caption-appearance-control', 'ft-caption-color-control')
    const label = document.createElement('span')
    const swatchButton = document.createElement('button')
    swatchButton.type = 'button'
    swatchButton.classList.add('ft-caption-color-swatch')
    swatchButton.ariaHasPopup = 'true'
    swatchButton.ariaExpanded = 'false'

    const popover = document.createElement('div')
    popover.classList.add('ft-caption-color-popover', 'shaka-hidden')
    const palette = document.createElement('div')
    palette.classList.add('ft-caption-color-palette')
    popover.appendChild(palette)

    const customColor = document.createElement('label')
    customColor.classList.add('ft-caption-custom-color')
    const customColorLabel = document.createElement('span')
    const customColorInput = document.createElement('input')
    customColorInput.type = 'text'
    customColorInput.maxLength = 7
    customColorInput.spellcheck = false
    customColorInput.autocomplete = 'off'
    customColorInput.placeholder = '#RRGGBB'
    customColor.append(customColorLabel, customColorInput)
    popover.appendChild(customColor)

    row.append(label, swatchButton, popover)
    this.appearanceControls_.appendChild(row)

    const control = { container: row, label, swatchButton, popover, customColorLabel, customColorInput }

    this.eventManager.listen(row, 'click', (event) => {
      if (popover.contains(event.target)) {
        return
      }

      const willOpen = popover.classList.contains('shaka-hidden')
      this.closeColorPopover_()
      if (willOpen) {
        this.openColorControl_ = control
        this.setMenuDisplay_(popover, true)
        swatchButton.ariaExpanded = 'true'
        customColorInput.focus()
        customColorInput.select()
      }
    })

    for (const color of CAPTION_COLOR_PALETTE) {
      const colorButton = document.createElement('button')
      colorButton.type = 'button'
      colorButton.classList.add('ft-caption-palette-color')
      colorButton.style.setProperty('--ft-caption-swatch-color', color)
      colorButton.ariaLabel = color
      palette.appendChild(colorButton)
      this.eventManager.listen(colorButton, 'click', () => {
        this.setColorControlValue_(control, color)
        this.updateSetting_(setting, color)
        this.closeColorPopover_()
        swatchButton.focus()
      })
    }

    this.eventManager.listen(customColorInput, 'input', () => {
      const color = customColorInput.value.trim()
      const valid = HEX_COLOR_PATTERN.test(color)
      customColorInput.ariaInvalid = valid || color === '' ? 'false' : 'true'
      if (valid) {
        this.setColorControlValue_(control, color.toLowerCase())
        this.updateSetting_(setting, color.toLowerCase())
      }
    })

    return control
  }

  /**
   * @param {'backgroundOpacity' | 'fontScale' | 'verticalPosition'} setting
   * @param {number} min
   * @param {number} max
   * @param {number} step
   * @returns {{label: HTMLSpanElement, input: HTMLInputElement}}
   * @private
   */
  createRangeControl_(setting, min, max, step) {
    const control = this.createControl_('input')
    control.input.type = 'range'
    control.input.min = min.toString()
    control.input.max = max.toString()
    control.input.step = step.toString()
    this.eventManager.listen(control.input, 'input', () => {
      const value = control.input.valueAsNumber
      this.updateSetting_(setting, value)
      this.updateRangeLabel_(setting, control.label, value)
    })
    return control
  }

  /**
   * @returns {{container: HTMLLabelElement, label: HTMLSpanElement, input: HTMLSelectElement}}
   * @private
   */
  createAnchorControl_() {
    const control = this.createControl_('select')
    control.container.classList.add('ft-caption-select-control')
    for (const anchor of CAPTION_ANCHORS) {
      const option = document.createElement('option')
      option.value = anchor
      control.input.appendChild(option)
    }
    this.eventManager.listen(control.input, 'change', () => {
      this.updateSetting_('anchor', control.input.value)
    })
    this.makeSelectControlClickable_(control)
    return control
  }

  /**
   * @returns {{label: HTMLSpanElement, input: HTMLSelectElement}}
   * @private
   */
  createEdgeStyleControl_() {
    const control = this.createControl_('select')
    control.container.classList.add('ft-caption-select-control')
    for (const edgeStyle of CAPTION_EDGE_STYLES) {
      const option = document.createElement('option')
      option.value = edgeStyle
      control.input.appendChild(option)
    }
    this.eventManager.listen(control.input, 'change', () => {
      this.updateSetting_('edgeStyle', control.input.value)
      this.updateEdgeColorVisibility_(control.input.value)
    })
    this.makeSelectControlClickable_(control)
    return control
  }

  /**
   * @param {{container: HTMLLabelElement, input: HTMLSelectElement}} control
   * @private
   */
  makeSelectControlClickable_(control) {
    this.eventManager.listen(control.container, 'click', (event) => {
      if (event.target === control.input) {
        return
      }

      event.preventDefault()
      control.input.focus()
      if (typeof control.input.showPicker === 'function') {
        control.input.showPicker()
      } else {
        control.input.click()
      }
    })
  }

  /**
   * @param {'input' | 'select'} elementName
   * @returns {{container: HTMLLabelElement, label: HTMLSpanElement, input: HTMLInputElement | HTMLSelectElement}}
   * @private
   */
  createControl_(elementName) {
    const label = document.createElement('label')
    label.classList.add('ft-caption-appearance-control')
    const labelText = document.createElement('span')
    const input = document.createElement(elementName)
    label.append(labelText, input)
    this.appearanceControls_.appendChild(label)
    return { container: label, label: labelText, input }
  }

  /** @private */
  updateLocalisedStrings_() {
    const optionsLabel = i18n.global.t('Video.Player.Caption Appearance.Options')
    const title = i18n.global.t('Video.Player.Caption Appearance.Title')

    this.optionsButton_.textContent = optionsLabel
    this.optionsButton_.ariaLabel = optionsLabel
    const autoTranslateLabel = i18n.global.t('Video.Player.Auto-translate')
    this.autoTranslateLabel_.textContent = autoTranslateLabel
    this.autoTranslateButton_.ariaLabel = autoTranslateLabel
    this.translationBackButton_.ariaLabel = this.localization.resolve('BACK')
    this.translationBackLabel_.textContent = autoTranslateLabel
    this.appearanceBackButton_.ariaLabel = this.localization.resolve('BACK')
    this.appearanceBackLabel_.textContent = title
    this.textColor_.label.textContent = i18n.global.t('Settings.Player Settings.Caption Appearance.Text Color')
    this.backgroundColor_.label.textContent = i18n.global.t('Settings.Player Settings.Caption Appearance.Background Color')
    this.textColor_.customColorLabel.textContent = i18n.global.t('Profile.Custom Color')
    this.backgroundColor_.customColorLabel.textContent = i18n.global.t('Profile.Custom Color')
    this.edgeColor_.customColorLabel.textContent = i18n.global.t('Profile.Custom Color')
    this.anchor_.label.textContent = i18n.global.t('Settings.Player Settings.Caption Appearance.Anchor.Anchor')
    this.edgeStyle_.label.textContent = i18n.global.t('Settings.Player Settings.Caption Appearance.Edge Style.Edge Style')
    this.edgeColor_.label.textContent = i18n.global.t('Settings.Player Settings.Caption Appearance.Edge Color')
    this.resetButton_.textContent = i18n.global.t('Settings.Player Settings.Caption Appearance.Reset')

    const edgeStyleLabels = [
      i18n.global.t('Settings.Player Settings.Caption Appearance.Edge Style.None'),
      i18n.global.t('Settings.Player Settings.Caption Appearance.Edge Style.Outline'),
      i18n.global.t('Settings.Player Settings.Caption Appearance.Edge Style.Drop Shadow'),
    ]
    Array.from(this.edgeStyle_.input.options).forEach((option, index) => {
      option.textContent = edgeStyleLabels[index]
    })

    const anchorLabels = [
      i18n.global.t('Settings.Player Settings.Caption Appearance.Anchor.Top Left'),
      i18n.global.t('Settings.Player Settings.Caption Appearance.Anchor.Top Center'),
      i18n.global.t('Settings.Player Settings.Caption Appearance.Anchor.Top Right'),
      i18n.global.t('Settings.Player Settings.Caption Appearance.Anchor.Bottom Left'),
      i18n.global.t('Settings.Player Settings.Caption Appearance.Anchor.Bottom Center'),
      i18n.global.t('Settings.Player Settings.Caption Appearance.Anchor.Bottom Right'),
    ]
    Array.from(this.anchor_.input.options).forEach((option, index) => {
      option.textContent = anchorLabels[index]
    })

    const settings = this.getSettings_()
    this.setColorControlValue_(this.textColor_, settings.textColor)
    this.setColorControlValue_(this.backgroundColor_, settings.backgroundColor)
    this.setColorControlValue_(this.edgeColor_, settings.edgeColor)
    this.updateRangeLabel_('backgroundOpacity', this.backgroundOpacity_.label, settings.backgroundOpacity)
    this.updateRangeLabel_('fontScale', this.fontScale_.label, settings.fontScale)
    this.updateRangeLabel_('verticalPosition', this.verticalPosition_.label, settings.verticalPosition)
  }

  /**
   * @param {'backgroundOpacity' | 'fontScale' | 'verticalPosition'} setting
   * @param {HTMLSpanElement} label
   * @param {number} value
   * @private
   */
  updateRangeLabel_(setting, label, value) {
    const settingLabels = {
      backgroundOpacity: i18n.global.t('Settings.Player Settings.Caption Appearance.Background Opacity'),
      fontScale: i18n.global.t('Settings.Player Settings.Caption Appearance.Font Size'),
      verticalPosition: i18n.global.t('Settings.Player Settings.Caption Appearance.Vertical Position'),
    }
    label.textContent = i18n.global.t('Display Label', {
      label: settingLabels[setting],
      value: `${Math.round(value * 100)}%`,
    })
  }

  /**
   * @param {ReturnType<import('../../../helpers/player/caption-settings').parseCaptionSettings>} settings
   * @private
   */
  updateAppearanceControls_(settings) {
    this.setColorControlValue_(this.textColor_, settings.textColor)
    this.setColorControlValue_(this.backgroundColor_, settings.backgroundColor)
    this.setColorControlValue_(this.edgeColor_, settings.edgeColor)
    this.backgroundOpacity_.input.value = settings.backgroundOpacity.toString()
    this.fontScale_.input.value = settings.fontScale.toString()
    this.anchor_.input.value = settings.anchor
    this.verticalPosition_.input.value = settings.verticalPosition.toString()
    this.edgeStyle_.input.value = settings.edgeStyle
    this.updateEdgeColorVisibility_(settings.edgeStyle)
    this.updateRangeLabel_('backgroundOpacity', this.backgroundOpacity_.label, settings.backgroundOpacity)
    this.updateRangeLabel_('fontScale', this.fontScale_.label, settings.fontScale)
    this.updateRangeLabel_('verticalPosition', this.verticalPosition_.label, settings.verticalPosition)
  }

  /**
   * @param {{label: HTMLSpanElement, swatchButton: HTMLButtonElement, customColorInput: HTMLInputElement}} control
   * @param {string} color
   * @private
   */
  setColorControlValue_(control, color) {
    control.swatchButton.style.setProperty('--ft-caption-swatch-color', color)
    control.swatchButton.ariaLabel = `${control.label.textContent}: ${color}`
    control.customColorInput.value = color
    control.customColorInput.ariaInvalid = 'false'
  }

  /**
   * @param {'none' | 'outline' | 'dropShadow'} edgeStyle
   * @private
   */
  updateEdgeColorVisibility_(edgeStyle) {
    if (edgeStyle === 'none') {
      this.closeColorPopover_()
    }
    this.setMenuDisplay_(this.edgeColor_.container, edgeStyle !== 'none')
  }

  /** @private */
  closeColorPopover_() {
    if (this.openColorControl_) {
      this.setMenuDisplay_(this.openColorControl_.popover, false)
      this.openColorControl_.swatchButton.ariaExpanded = 'false'
      this.openColorControl_ = null
    }
  }

  /**
   * @param {HTMLElement} menu
   * @param {boolean} visible
   * @private
   */
  setMenuDisplay_(menu, visible) {
    menu.classList.toggle('shaka-hidden', !visible)
  }

  /** @private */
  addCaptionActions_() {
    this.updateTranslationOptions_()

    if (!this.menu.contains(this.optionsButton_)) {
      this.menu.querySelector('.shaka-back-to-overflow-button')?.after(this.optionsButton_)
    }

    if (this.getTranslations_().length > 0) {
      if (!this.menu.contains(this.autoTranslateButton_)) {
        this.menu.appendChild(this.autoTranslateButton_)
      }
    } else {
      this.autoTranslateButton_.remove()
    }
  }

  /** @private */
  updateTranslationOptions_() {
    const translations = this.getTranslations_()
    const signature = translations.map(translation => `${translation.id}\0${translation.url}`).join('\n')
    if (signature === this.translationSignature_) {
      return
    }

    this.translationSignature_ = signature
    for (const button of this.translationOptions_.querySelectorAll(':scope > button')) {
      button.remove()
    }

    for (const translation of translations) {
      const button = document.createElement('button')
      button.type = 'button'
      const label = document.createElement('span')
      label.textContent = translation.translationName
      button.appendChild(label)
      this.translationOptions_.appendChild(button)

      this.eventManager.listen(button, 'click', async () => {
        button.disabled = true
        const selected = await this.selectTranslation_(translation)
        button.disabled = false

        if (selected) {
          this.setMenuDisplay_(this.translationMenu_, false)
          this.setMenuDisplay_(this.menu, true)
          this.menu.querySelector('.shaka-back-to-overflow-button')?.focus({ preventScroll: true })
          this.resetMenuScroll_(this.menu.parentElement)
        }
      })
    }
  }

  /** @private */
  resetMenuScroll_(scrollViewport) {
    requestAnimationFrame(() => {
      if (scrollViewport instanceof HTMLElement) {
        restoreOverlayScrollTop(scrollViewport, 0)
      }
    })
  }
}
