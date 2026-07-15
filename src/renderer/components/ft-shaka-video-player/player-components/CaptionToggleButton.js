import shaka from 'shaka-player'

export class CaptionToggleButton extends shaka.ui.Element {
  /**
   * @param {() => void} toggleCaptions
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(toggleCaptions, events, parent, controls) {
    super(parent, controls)

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('caption-toggle-button', 'shaka-no-propagation', 'shaka-tooltip')

    /** @private */
    this.icon_ = new shaka.ui.Icon(
      this.button_,
      shaka.ui.Enums.MaterialDesignSVGIcons.CLOSED_CAPTIONS_OFF
    )

    this.parent.appendChild(this.button_)

    this.eventManager.listen(this.button_, 'click', toggleCaptions)
    this.eventManager.listen(events, 'localeChanged', () => this.update_())
    this.eventManager.listenMulti(
      this.player,
      ['loading', 'loaded', 'unloading', 'textchanged', 'trackschanged'],
      () => this.update_()
    )

    this.update_()
  }

  /** @private */
  update_() {
    const tracks = this.player.getTextTracks() ?? []
    const captionsEnabled = tracks.some(track => track.active)

    this.icon_.use(captionsEnabled
      ? shaka.ui.Enums.MaterialDesignSVGIcons.CLOSED_CAPTIONS
      : shaka.ui.Enums.MaterialDesignSVGIcons.CLOSED_CAPTIONS_OFF)
    this.button_.ariaLabel = this.localization.resolve('CAPTIONS')
    this.button_.ariaPressed = captionsEnabled ? 'true' : 'false'
    this.button_.classList.toggle('shaka-hidden', tracks.length === 0)
  }
}
