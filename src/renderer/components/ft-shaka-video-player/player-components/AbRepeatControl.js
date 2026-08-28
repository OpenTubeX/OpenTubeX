import shaka from 'shaka-player'
import { watch } from 'vue'

import i18n from '../../../i18n/index'
import { localizeAndAddKeyboardShortcutToActionTitle } from '../../../helpers/utils'
import { formatAbRepeatTimestamp } from '../../../helpers/player/abRepeat'
import { scheduleOverflowMenuScrollClamp } from './overflowMenu'

export const AB_REPEAT_ICON = Object.freeze({
  path: 'M4 4h13V1l5 4-5 4V6H4V4Zm16 16H7v3l-5-4 5-4v3h13v2ZM7 10h2v5H7v-5Zm8 0h2v5h-2v-5Zm-6 1.5h6v2H9v-2Z',
  viewBox: '0 0 24 24',
})

const CLEAR_AB_REPEAT_ICON = Object.freeze({
  path: 'M7 21q-.825 0-1.412-.587T5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.587 1.413T17 21zM17 6H7v13h10zM9 17h2V8H9zm4 0h2V8h-2zM7 6v13z',
  viewBox: '0 0 24 24',
})

/**
 * @typedef {{
 *   start: import('vue').Ref<number | null>,
 *   end: import('vue').Ref<number | null>,
 *   enabled: import('vue').Ref<boolean>,
 *   validation: import('vue').ComputedRef<string | null>,
 *   validationMessage: import('vue').ComputedRef<string>,
 *   setCurrentBoundary: (point: 'start' | 'end') => void,
 *   toggle: () => void,
 *   clear: () => void,
 *   getShortcut: (action: 'start' | 'end' | 'clear') => string,
 * }} AbRepeatContext
 */

/** @type {WeakMap<shaka.ui.Controls, AbRepeatContext>} */
const abRepeatContexts = new WeakMap()

/**
 * @param {shaka.ui.Controls} controls
 * @param {AbRepeatContext} context
 * @returns {() => void}
 */
export function setAbRepeatContext(controls, context) {
  abRepeatContexts.set(controls, context)
  return () => {
    if (abRepeatContexts.get(controls) === context) {
      abRepeatContexts.delete(controls)
    }
  }
}

export class AbRepeatControl extends shaka.ui.Element {
  /**
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(parent, controls) {
    super(parent, controls)

    const context = abRepeatContexts.get(controls)
    if (!context) {
      throw new Error('Missing A-B repeat context')
    }

    /** @private */
    this.context_ = context
    /** @private */
    this.hadPoint_ = context.start.value !== null || context.end.value !== null

    this.createRepeatButton_()
    this.createClearButton_()

    this.eventManager.listen(this.button_, 'click', () => this.handleRepeatAction_())
    this.eventManager.listen(this.clearButton_, 'click', () => context.clear())
    this.eventManager.listenMulti(this.controls, ['submenuopen', 'submenuclose'], () => {
      this.updateVisibility_()
    })
    this.eventManager.listenMulti(
      this.localization,
      [shaka.ui.Localization.LOCALE_CHANGED, shaka.ui.Localization.LOCALE_UPDATED],
      () => this.updateLocalisedStrings_()
    )
    this.eventManager.listenMulti(this.player, ['unloading', 'loaded', 'manifestupdated'], () => {
      this.updateVisibility_()
    })

    /** @private */
    this.stopStateWatch_ = watch(
      [context.start, context.end, context.enabled, context.validation, context.validationMessage],
      () => this.updateLocalisedStrings_()
    )

    this.updateLocalisedStrings_()
  }

  release() {
    this.stopStateWatch_()
    super.release()
  }

  /** @private */
  createRepeatButton_() {
    this.button_ = document.createElement('button')
    this.button_.type = 'button'
    this.button_.classList.add('ab-repeat-button', 'shaka-no-propagation', 'shaka-tooltip')

    // eslint-disable-next-line no-new
    new shaka.ui.Icon(this.button_, AB_REPEAT_ICON)

    const label = document.createElement('label')
    label.classList.add(
      'shaka-overflow-button-label',
      'shaka-overflow-menu-only',
      'shaka-simple-overflow-button-label-inline'
    )

    this.nameSpan_ = document.createElement('span')
    label.appendChild(this.nameSpan_)

    this.currentState_ = document.createElement('span')
    this.currentState_.classList.add('shaka-current-selection-span')
    label.appendChild(this.currentState_)

    this.button_.appendChild(label)
    this.parent.appendChild(this.button_)
  }

  /** @private */
  createClearButton_() {
    this.clearButton_ = document.createElement('button')
    this.clearButton_.type = 'button'
    this.clearButton_.classList.add(
      'ab-repeat-clear-button',
      'shaka-no-propagation',
      'shaka-tooltip'
    )

    // eslint-disable-next-line no-new
    new shaka.ui.Icon(this.clearButton_, CLEAR_AB_REPEAT_ICON)

    const label = document.createElement('label')
    label.classList.add(
      'shaka-overflow-button-label',
      'shaka-overflow-menu-only',
      'shaka-simple-overflow-button-label-inline'
    )

    this.clearNameSpan_ = document.createElement('span')
    label.appendChild(this.clearNameSpan_)
    this.clearButton_.appendChild(label)
    this.parent.appendChild(this.clearButton_)
  }

  /** @private */
  handleRepeatAction_() {
    const { start, end, validation } = this.context_

    if (start.value === null) {
      this.controls.hideSettingsMenus()
      this.context_.setCurrentBoundary('start')
    } else if (end.value === null || validation.value !== null) {
      this.controls.hideSettingsMenus()
      this.context_.setCurrentBoundary('end')
    } else {
      this.context_.toggle()
    }
  }

  /** @private */
  updateLocalisedStrings_() {
    const { start, end, enabled, validation, validationMessage } = this.context_
    const startLabel = formatAbRepeatTimestamp(start.value)
    const endLabel = formatAbRepeatTimestamp(end.value)
    const valid = start.value !== null && end.value !== null && validation.value === null

    let repeatAction = i18n.global.t('Video.Player.A-B Repeat.Set Repeat Start')
    let shortcut = this.context_.getShortcut('start')
    if (start.value !== null && (end.value === null || validation.value !== null)) {
      repeatAction = i18n.global.t('Video.Player.A-B Repeat.Set Repeat End')
      shortcut = this.context_.getShortcut('end')
    } else if (valid) {
      repeatAction = enabled.value
        ? i18n.global.t('Video.Player.A-B Repeat.Pause Repeat')
        : i18n.global.t('Video.Player.A-B Repeat.Resume Repeat')
      shortcut = ''
    }

    this.nameSpan_.textContent = repeatAction
    this.button_.ariaLabel = shortcut
      ? localizeAndAddKeyboardShortcutToActionTitle(repeatAction, shortcut)
      : repeatAction

    if (validationMessage.value) {
      this.currentState_.textContent = validationMessage.value
      this.button_.removeAttribute('aria-pressed')
    } else if (valid) {
      this.currentState_.textContent = `${startLabel}–${endLabel}`
      this.button_.ariaPressed = enabled.value ? 'true' : 'false'
    } else if (startLabel) {
      this.currentState_.textContent = `A ${startLabel}`
      this.button_.removeAttribute('aria-pressed')
    } else if (endLabel) {
      this.currentState_.textContent = `B ${endLabel}`
      this.button_.removeAttribute('aria-pressed')
    } else {
      this.currentState_.textContent = i18n.global.t('Video.Player.A-B Repeat.Off')
      this.button_.removeAttribute('aria-pressed')
    }

    const clearAction = i18n.global.t('Video.Player.A-B Repeat.Clear Range')
    this.clearNameSpan_.textContent = clearAction
    this.clearButton_.ariaLabel = localizeAndAddKeyboardShortcutToActionTitle(
      clearAction,
      this.context_.getShortcut('clear')
    )

    this.updateVisibility_()
  }

  /** @private */
  updateVisibility_() {
    const unavailable = this.isSubMenuOpened || this.player.isLive()
    const hasPoint = this.context_.start.value !== null || this.context_.end.value !== null
    this.button_.classList.toggle('shaka-hidden', unavailable)
    this.clearButton_.classList.toggle('shaka-hidden', unavailable || !hasPoint)

    if (this.hadPoint_ && !hasPoint) {
      scheduleOverflowMenuScrollClamp(this.parent)
    }
    this.hadPoint_ = hasPoint
  }
}
