import shaka from 'shaka-player'

/**
 * Replaces Shaka's reset button of the caption style, which restores Shaka's defaults
 * rather than the default caption settings.
 */
export class CaptionStyleResetButton extends shaka.ui.Element {
  /**
   * @param {() => void} reset
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(reset, parent, controls) {
    super(parent, controls)

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('shaka-caption-style-reset-button', 'shaka-tooltip')
    // eslint-disable-next-line no-new
    new shaka.ui.Icon(this.button_, shaka.ui.Enums.MaterialDesignSVGIcons.RESET)

    const label = document.createElement('label')
    label.classList.add('shaka-overflow-button-label', 'shaka-overflow-menu-only')
    /** @private */
    this.nameSpan_ = document.createElement('span')
    label.appendChild(this.nameSpan_)
    this.button_.appendChild(label)
    this.parent.appendChild(this.button_)

    this.eventManager.listen(this.button_, 'click', reset)
    this.eventManager.listenMulti(
      this.localization,
      [shaka.ui.Localization.LOCALE_UPDATED, shaka.ui.Localization.LOCALE_CHANGED],
      () => this.updateLocalizedStrings_()
    )
    this.eventManager.listenMulti(this.player, ['loading', 'unloading', 'trackschanged'], () => this.checkAvailability())

    this.updateLocalizedStrings_()
    this.checkAvailability()
  }

  /** Like Shaka's style menus, only available while there are captions. */
  checkAvailability() {
    this.button_.classList.toggle('shaka-hidden', Boolean(this.isSubMenuOpened) ||
      !this.controls.getConfig().captionsStyles || this.player.getTextTracks().length === 0)
  }

  /** @private */
  updateLocalizedStrings_() {
    const label = this.localization.resolve('RESET')
    this.button_.ariaLabel = label
    this.nameSpan_.textContent = label
  }
}
