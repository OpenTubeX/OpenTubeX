import shaka from 'shaka-player'
import { h, render } from 'vue'
import { FtIcon } from '@opentubex/icons'

import i18n from '../../../i18n/index'
import { CaptionTiming } from './CaptionTiming'
import {
  addOverlayScrollbars,
  clampOverlayScrollTop,
  removeOverlayScrollbars,
  restoreOverlayScrollTop,
} from '../../../helpers/overlayScrollbars'
import { goBackOnEmptyClicks } from '../../../helpers/player/emptyMenuClicks'

/**
 * Shaka's caption style menu group, opened from the Options button of the captions menu
 * rather than its own entry in the overflow menu.
 */
class CaptionStyleGroup extends shaka.ui.MenuGroup {
  /**
   * @param {!HTMLElement} parent
   * @param {!shaka.ui.Controls} controls
   */
  constructor(parent, controls) {
    super(parent, controls, shaka.ui.Enums.MaterialDesignSVGIcons.CLOSED_CAPTIONS_STYLE)
    this.menu.classList.add('ft-caption-style-menu')
  }

  getName() {
    return this.localization.resolve('STYLE')
  }

  getChildElementNames() {
    return this.controls.getConfig().captionsStyleElements
  }

  checkAvailability() {
    this.button?.classList.add('shaka-hidden')
  }
}

export class CaptionSelection extends shaka.ui.TextSelection {
  /**
   * @param {EventTarget} events
   * @param {() => {id: string, url: string, label: string, translationName: string, language: string, mimeType: string}[]} getTranslations
   * @param {(caption: {id: string, url: string, label: string, language: string, mimeType: string}) => boolean} isTranslationSelected
   * @param {(caption: {url: string, label: string, language: string, mimeType: string}) => Promise<boolean>} selectTranslation
   * @param {{
   *   getOptions: () => {url: string, label: string, language: string, mimeType: string}[],
   *   isAvailable: () => boolean,
   *   isSelected: (caption: {url: string, label: string, language: string, mimeType: string} | null) => boolean,
   *   select: (caption: {url: string, label: string, language: string, mimeType: string} | null) => Promise<boolean>
   * }} secondary
   * @param {{isAvailable: () => boolean, load: () => Promise<boolean>}} localFile
   * @param {{getOffset: () => number, setOffset: (offset: number) => void}} timing
   * @param {!HTMLElement} parent
   * @param {!shaka.ui.Controls} controls
   */
  constructor(events, getTranslations, isTranslationSelected, selectTranslation, secondary, localFile, timing, parent, controls) {
    super(parent, controls)
    this.localFile_ = localFile

    if (this.isSubMenu) {
      // Shaka rebuilds the language choices and tries to focus a hidden item
      // on every submenu transition. Track and locale events already keep the
      // choices current; refresh only the custom actions from reactive props.
      for (const [type, opened] of [['submenuopen', true], ['submenuclose', false]]) {
        this.eventManager.unlisten(controls, type)
        this.eventManager.listen(controls, type, (event) => {
          // Like shaka.ui.Element, only react to submenus in our own container
          if (event.container && event.container !== this.parent) return
          this.isSubMenuOpened = opened
          this.updateButtonDisplay_()
          if (opened) {
            this.addCaptionActions_()
          }
        })
      }
    }

    this.getTranslations_ = getTranslations
    this.isTranslationSelected_ = isTranslationSelected
    this.selectTranslation_ = selectTranslation
    this.secondary_ = secondary
    this.captionsOffButton_ = null
    this.timing_ = new CaptionTiming(events, timing, this.menu, parent, controls)

    // Scrolls the choices on their own, so that the header and the actions below
    // them stay in view. Shaka rebuilds the choices directly in the menu, so
    // `addCaptionActions_` moves them in here after every rebuild.
    this.choices_ = document.createElement('div')
    this.choices_.classList.add('ft-caption-list-options')
    addOverlayScrollbars(this.choices_)
    // A taller list, for example in a larger player, shortens its scroll range.
    this.choicesObserver_ = new ResizeObserver(() => this.clampChoicesScroll_())
    this.choicesObserver_.observe(this.choices_)

    this.translationMenu_ = this.createOptionsMenu_(parent, 'ft-caption-auto-translate-button', 'ft-caption-translation')
    this.secondaryMenu_ = this.createOptionsMenu_(parent, 'ft-caption-secondary-button', 'ft-caption-secondary')

    this.styleGroup_ = new CaptionStyleGroup(parent, controls)
    this.optionsButton_ = document.createElement('button')
    this.optionsButton_.type = 'button'
    // The phone layout moves it into its header while it fits (`setupPhoneOptionsMenu`)
    this.optionsButton_.classList.add('ft-caption-options-button', 'ft-submenu-header-action')
    this.eventManager.listen(this.optionsButton_, 'click', (event) => {
      event.stopPropagation()
      this.setMenuDisplay_(this.menu, false)
      this.setMenuDisplay_(this.styleGroup_.menu, true)
      restoreOverlayScrollTop(this.styleGroup_.menu, 0)
      this.styleGroup_.backButton.focus({ preventScroll: true })
    })
    // Shaka's listener on the menu would return to the overflow menu instead
    this.eventManager.listen(this.styleGroup_.backButton, 'click', (event) => {
      event.stopPropagation()
      this.setMenuDisplay_(this.styleGroup_.menu, false)
      this.setMenuDisplay_(this.menu, true)
      this.optionsButton_.focus({ preventScroll: true })
    })

    this.loadFileButton_ = document.createElement('button')
    this.loadFileButton_.type = 'button'
    this.loadFileButton_.classList.add('ft-caption-load-file-button')
    this.loadFileIcon_ = document.createElement('span')
    render(h(FtIcon, { icon: 'folder-open', 'aria-hidden': 'true' }), this.loadFileIcon_)
    this.loadFileLabel_ = document.createElement('span')
    this.loadFileButton_.append(this.loadFileIcon_, this.loadFileLabel_)

    // The grid menu pins these rows to its bottom and lays them out side by side when both
    // labels fit, so it reserves however much room they take up.
    this.actions_ = document.createElement('div')
    this.actions_.classList.add('ft-caption-actions')
    this.actionsObserver_ = new ResizeObserver(([entry]) => {
      const size = entry.borderBoxSize[0].blockSize
      if (size > 0) {
        this.menu.style.setProperty('--ft-caption-actions-size', `${size}px`)
      }
    })
    this.actionsObserver_.observe(this.actions_)

    // Not disabled while the file picker is open, Android doesn't report when it gets canceled
    this.eventManager.listen(this.loadFileButton_, 'click', async (event) => {
      event.stopPropagation()
      if (await this.localFile_.load()) {
        this.controls.hideSettingsMenus()
      }
    })

    // Shaka hides the captions button while a video has no tracks, but a
    // subtitle file can still be loaded then. These run after Shaka's listeners.
    this.eventManager.listenMulti(
      this.player,
      ['loading', 'loaded', 'unloading', 'textchanged', 'trackschanged'],
      () => this.updateButtonDisplay_()
    )
    this.eventManager.listenMulti(
      this.localization,
      [shaka.ui.Localization.LOCALE_UPDATED, shaka.ui.Localization.LOCALE_CHANGED],
      () => this.updateButtonDisplay_()
    )

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
      this.addCaptionActions_()
    })

    // Shaka rebuilds the language menu whenever tracks or caption state change.
    this.eventManager.listen(this.controls, 'captionselectionupdated', () => {
      this.addCaptionActions_()
    })

    this.eventManager.listen(this.controls, 'submenuclose', () => {
      this.setMenuDisplay_(this.translationMenu_.menu, false)
      this.setMenuDisplay_(this.secondaryMenu_.menu, false)
    })

    this.updateLocalisedStrings_()
    this.addCaptionActions_()
    this.updateButtonDisplay_()
  }

  release() {
    this.actionsObserver_.disconnect()
    this.choicesObserver_.disconnect()
    this.timing_.release()
    this.styleGroup_.release()
    this.styleGroup_.button.remove()
    this.styleGroup_.menu.remove()
    this.optionsButton_.remove()
    render(null, this.loadFileIcon_)
    this.actions_.remove()
    removeOverlayScrollbars(this.choices_)
    this.choices_.remove()
    for (const optionsMenu of [this.translationMenu_, this.secondaryMenu_]) {
      cancelAnimationFrame(optionsMenu.overlayFrame)
      removeOverlayScrollbars(optionsMenu.options)
      optionsMenu.menu.remove()
    }
    super.release()
  }

  /**
   * Creates a submenu that lists choices, opened by a button in the captions menu.
   * @param {!HTMLElement} parent
   * @param {string} buttonClass
   * @param {string} menuClass prefix of the classes that identify the submenu and its choices
   * @returns {{button: HTMLButtonElement, label: HTMLSpanElement, menu: HTMLDivElement, backButton: HTMLButtonElement, backLabel: HTMLSpanElement, options: HTMLDivElement, buttons: HTMLButtonElement[], signature: string, overlayFrame: number}}
   * @private
   */
  createOptionsMenu_(parent, buttonClass, menuClass) {
    const button = document.createElement('button')
    button.type = 'button'
    button.classList.add(buttonClass)
    const label = document.createElement('span')
    button.appendChild(label)

    const menu = document.createElement('div')
    menu.classList.add(
      'shaka-no-propagation',
      'shaka-show-controls-on-mouse-over',
      'shaka-hidden',
      'ft-caption-list-menu',
      `${menuClass}-menu`,
      this.isSubMenu ? 'shaka-sub-menu' : 'shaka-settings-menu'
    )
    const menuParent = this.isSubMenu ? parent : this.controls.getControlsContainer()
    menuParent.appendChild(menu)

    const backButton = document.createElement('button')
    backButton.classList.add('shaka-back-to-overflow-button')
    menu.appendChild(backButton)
    // eslint-disable-next-line no-new
    new shaka.ui.Icon(backButton, shaka.ui.Enums.MaterialDesignSVGIcons.BACK)
    const backLabel = document.createElement('span')
    backButton.appendChild(backLabel)
    const options = document.createElement('div')
    options.classList.add('ft-caption-list-options', `${menuClass}-options`)
    menu.appendChild(options)

    const optionsMenu = { button, label, menu, backButton, backLabel, options, buttons: [], signature: '', overlayFrame: 0 }

    this.eventManager.listen(button, 'click', (event) => {
      event.stopPropagation()
      this.setMenuDisplay_(this.menu, false)
      this.setMenuDisplay_(menu, true)
      backButton.focus({ preventScroll: true })
      cancelAnimationFrame(optionsMenu.overlayFrame)
      optionsMenu.overlayFrame = requestAnimationFrame(() => {
        optionsMenu.overlayFrame = 0
        addOverlayScrollbars(options)
        restoreOverlayScrollTop(options, 0)
      })
    })

    const goBack = () => {
      this.setMenuDisplay_(menu, false)
      this.setMenuDisplay_(this.menu, true)
      button.focus({ preventScroll: true })
      this.resetMenuScroll_(this.menu.parentElement)
    }
    this.eventManager.listen(backButton, 'click', goBack)

    goBackOnEmptyClicks(this.eventManager, menu, goBack)

    return optionsMenu
  }

  /**
   * Rebuilds the choices of an options submenu when they changed.
   * @template T
   * @param {ReturnType<CaptionSelection['createOptionsMenu_']>} optionsMenu
   * @param {{key: string, label: string, value: T}[]} choices
   * @param {(value: T) => Promise<boolean>} select
   * @param {(value: T) => boolean} isSelected
   * @private
   */
  updateOptionsMenu_(optionsMenu, choices, select, isSelected) {
    const signature = choices.map(choice => `${choice.key}\0${choice.label}`).join('\n')
    if (signature !== optionsMenu.signature) {
      optionsMenu.signature = signature
      for (const button of optionsMenu.buttons) {
        this.eventManager.unlisten(button, 'click')
        button.remove()
      }
      optionsMenu.buttons = []

      for (const choice of choices) {
        const button = document.createElement('button')
        button.type = 'button'
        const label = document.createElement('span')
        label.textContent = choice.label
        button.appendChild(label)
        optionsMenu.options.appendChild(button)
        optionsMenu.buttons.push(button)

        this.eventManager.listen(button, 'click', async () => {
          button.disabled = true
          const selected = await select(choice.value)
          button.disabled = false
          // Also after a failed selection, which can clear the previous choice
          this.updateOptionsSelection_(optionsMenu, choices, isSelected)

          if (selected) {
            this.setMenuDisplay_(optionsMenu.menu, false)
            this.setMenuDisplay_(this.menu, true)
            this.menu.querySelector('.shaka-back-to-overflow-button')?.focus({ preventScroll: true })
            this.resetMenuScroll_(this.menu.parentElement)
          }
        })
      }
    }

    this.updateOptionsSelection_(optionsMenu, choices, isSelected)
  }

  /**
   * @template T
   * @param {ReturnType<CaptionSelection['createOptionsMenu_']>} optionsMenu
   * @param {{value: T}[]} choices
   * @param {(value: T) => boolean} isSelected
   * @private
   */
  updateOptionsSelection_(optionsMenu, choices, isSelected) {
    for (const [index, choice] of choices.entries()) {
      const button = optionsMenu.buttons[index]
      const label = button.querySelector(':scope > span')
      const selected = isSelected(choice.value)
      label.classList.toggle('shaka-chosen-item', selected)
      button.ariaSelected = selected ? 'true' : 'false'
      button.querySelector(':scope > .shaka-ui-icon.shaka-chosen-item')?.remove()
      if (selected) {
        const checkmark = new shaka.ui.Icon(
          null,
          shaka.ui.Enums.MaterialDesignSVGIcons.CHECKMARK
        ).getSvgElement()
        checkmark.classList.add('shaka-chosen-item')
        checkmark.ariaHidden = 'true'
        button.prepend(checkmark)
      }
    }
  }

  /** @private */
  updateLocalisedStrings_() {
    this.optionsButton_.textContent = i18n.global.t('Video.Player.Caption Appearance.Options')
    this.loadFileLabel_.textContent = i18n.global.t('Video.Player.Subtitle File.Load')
    for (const [optionsMenu, label] of [
      [this.translationMenu_, i18n.global.t('Video.Player.Auto-translate')],
      [this.secondaryMenu_, i18n.global.t('Video.Player.Secondary Captions')],
    ]) {
      optionsMenu.label.textContent = label
      optionsMenu.button.ariaLabel = label
      optionsMenu.backButton.ariaLabel = this.localization.resolve('BACK')
      optionsMenu.backLabel.textContent = label
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
    const captionsOffButton = this.menu.querySelector('.shaka-turn-captions-off-button')
    if (this.captionsOffButton_ && this.captionsOffButton_ !== captionsOffButton) {
      // Shaka removes the old choice from the menu but its EventManager still
      // retains the button and callback until the entire control is released.
      this.eventManager.unlisten(this.captionsOffButton_, 'click')
    }
    this.captionsOffButton_ = captionsOffButton

    const translations = this.getTranslations_()
    this.updateOptionsMenu_(
      this.translationMenu_,
      translations.map(translation => ({ key: `${translation.id}\0${translation.url}`, label: translation.translationName, value: translation })),
      this.selectTranslation_,
      this.isTranslationSelected_
    )
    const secondaryCaptions = this.secondary_.getOptions()
    this.updateOptionsMenu_(
      this.secondaryMenu_,
      [
        { key: '', label: this.localization.resolve('OFF'), value: null },
        ...secondaryCaptions.map(caption => ({ key: caption.url, label: caption.label, value: caption })),
      ],
      this.secondary_.select,
      this.secondary_.isSelected
    )

    const backButton = this.menu.querySelector(':scope > .shaka-back-to-overflow-button')
    if (!this.menu.contains(this.optionsButton_)) {
      backButton?.after(this.optionsButton_)
    }
    if (this.choices_.parentElement !== this.menu) {
      // Shaka removed the previous choices along with their list.
      for (const choice of this.choices_.querySelectorAll(':scope > button')) {
        choice.remove()
      }
      this.optionsButton_.after(this.choices_)
    }
    const rebuiltChoices = [...this.menu.children].filter(child => {
      return child.localName === 'button' && child !== backButton && child !== this.optionsButton_
    })
    if (rebuiltChoices.length > 0) {
      // Moving the choice Shaka focused would drop its focus.
      const focused = this.menu.ownerDocument.activeElement
      this.choices_.prepend(...rebuiltChoices)
      if (rebuiltChoices.includes(focused)) {
        focused.focus()
      }
    }

    for (const [optionsMenu, available] of [
      [this.translationMenu_, translations.length > 0],
      [this.secondaryMenu_, this.secondary_.isAvailable()],
    ]) {
      if (!available) {
        optionsMenu.button.remove()
      } else if (optionsMenu.button.parentElement !== this.choices_) {
        this.choices_.appendChild(optionsMenu.button)
      }
    }
    if (!this.localFile_.isAvailable()) {
      this.loadFileButton_.remove()
    } else if (!this.actions_.contains(this.loadFileButton_)) {
      this.actions_.prepend(this.loadFileButton_)
    }
    if (this.actions_.lastElementChild !== this.timing_.button) {
      this.actions_.appendChild(this.timing_.button)
    }
    if (this.menu.lastElementChild !== this.actions_) {
      this.menu.appendChild(this.actions_)
    }
    this.clampChoicesScroll_()
  }

  /**
   * Keeps the choices' scroll offset within their range after it shrinks.
   * @private
   */
  clampChoicesScroll_() {
    if (!this.menu.classList.contains('shaka-hidden')) {
      clampOverlayScrollTop(this.choices_, this.choices_.querySelector(':scope > button:last-of-type'))
    }
  }

  /** @private */
  updateButtonDisplay_() {
    const hasTracks = this.player.getTextTracks().length > 0
    this.button.classList.toggle('shaka-hidden', Boolean(this.isSubMenuOpened) ||
      (!hasTracks && !this.localFile_.isAvailable()))
    // Like Shaka's caption style menus
    this.optionsButton_.classList.toggle('shaka-hidden', !hasTracks || !this.controls.getConfig().captionsStyles)
  }

  /** @private */
  resetMenuScroll_(scrollViewport) {
    requestAnimationFrame(() => {
      if (scrollViewport instanceof HTMLElement) {
        restoreOverlayScrollTop(scrollViewport, 0)
      }
      restoreOverlayScrollTop(this.choices_, 0)
    })
  }
}
