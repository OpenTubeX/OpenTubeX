import shaka from 'shaka-player'
import { watch } from 'vue'

/**
 * Shared Shaka overflow-menu control for boolean Vue settings.
 */
export class BooleanSettingButton extends shaka.ui.Element {
  /**
   * @param {object} options
   * @param {import('vue').ComputedRef<boolean>} options.value
   * @param {(value: boolean) => void} options.updateValue
   * @param {EventTarget} options.events
   * @param {string} options.className
   * @param {string} options.icon
   * @param {() => string} options.getLabel
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor({ value, updateValue, events, className, icon, getLabel }, parent, controls) {
    super(parent, controls)

    /** @private */
    this.value_ = value

    /** @private */
    this.updateValue_ = updateValue

    /** @private */
    this.getLabel_ = getLabel

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add(className, 'shaka-no-propagation', 'shaka-tooltip')

    /** @private */
    this.icon_ = new shaka.ui.Icon(this.button_, icon)

    const label = document.createElement('label')
    label.classList.add(
      'shaka-overflow-button-label',
      'shaka-overflow-menu-only',
      'shaka-simple-overflow-button-label-inline'
    )

    /** @private */
    this.nameSpan_ = document.createElement('span')
    label.appendChild(this.nameSpan_)

    /** @private */
    this.currentState_ = document.createElement('span')
    this.currentState_.classList.add('shaka-current-selection-span', 'ft-toggle-state')

    /** @private */
    this.currentStateValue_ = document.createElement('span')
    this.currentState_.appendChild(this.currentStateValue_)

    /** @private */
    this.currentStateSizer_ = document.createElement('span')
    this.currentStateSizer_.classList.add('ft-toggle-state-sizer')
    this.currentStateSizer_.ariaHidden = 'true'
    this.currentState_.appendChild(this.currentStateSizer_)
    label.appendChild(this.currentState_)

    this.button_.appendChild(label)
    this.parent.appendChild(this.button_)

    this.eventManager.listen(this.button_, 'click', () => {
      this.updateValue_(!this.value_.value)
    })

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    if (this.isSubMenu) {
      this.eventManager.listen(this.controls, 'submenuopen', () => {
        this.updateVisibility_()
      })

      this.eventManager.listen(this.controls, 'submenuclose', () => {
        this.updateVisibility_()
      })
    }

    /** @private */
    this.stopValueWatch_ = watch(this.value_, () => {
      this.updateLocalisedStrings_()
    })

    this.updateLocalisedStrings_()
  }

  release() {
    this.stopValueWatch_()
    super.release()
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = this.getLabel_()
    const enabledLabel = this.localization.resolve('ON')
    const disabledLabel = this.localization.resolve('OFF')

    this.nameSpan_.textContent = label
    this.currentStateValue_.textContent = this.value_.value ? enabledLabel : disabledLabel
    this.currentStateSizer_.textContent = this.value_.value ? disabledLabel : enabledLabel
    this.button_.ariaLabel = label
    this.button_.ariaPressed = this.value_.value ? 'true' : 'false'
  }

  /** @private */
  updateVisibility_() {
    this.button_.classList.toggle('shaka-hidden', this.isSubMenuOpened)
  }
}
