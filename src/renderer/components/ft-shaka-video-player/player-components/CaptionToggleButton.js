import shaka from 'shaka-player'

const CLOSED_CAPTIONS_OUTLINED = 'M200-160q-33 0-56.5-23.5T120-240v-480q0-33 23.5-56.5T200-800h560q33 0 56.5 23.5T840-720v480q0 33-23.5 56.5T760-160H200Zm0-80h560v-480H200v480Zm80-120h120q17 0 28.5-11.5T440-400v-20q0-9-6-15t-15-6h-18q-9 0-15 6t-6 15h-80v-120h80q0 9 6 15t15 6h18q9 0 15-6t6-15v-20q0-17-11.5-28.5T400-600H280q-17 0-28.5 11.5T240-560v160q0 17 11.5 28.5T280-360Zm400-240H560q-17 0-28.5 11.5T520-560v160q0 17 11.5 28.5T560-360h120q17 0 28.5-11.5T720-400v-20q0-9-6-15t-15-6h-18q-9 0-15 6t-6 15h-80v-120h80q0 9 6 15t15 6h18q9 0 15-6t6-15v-20q0-17-11.5-28.5T680-600ZM200-240v-480 480Z'

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

    const outlinedIcon = new shaka.ui.Icon(this.button_, CLOSED_CAPTIONS_OUTLINED)
    outlinedIcon.getSvgElement().classList.add('ft-caption-toggle-icon', 'ft-caption-toggle-icon-outlined')

    const filledIcon = new shaka.ui.Icon(
      this.button_,
      shaka.ui.Enums.MaterialDesignSVGIcons.CLOSED_CAPTIONS
    )
    filledIcon.getSvgElement().classList.add('ft-caption-toggle-icon', 'ft-caption-toggle-icon-filled')

    const slash = document.createElement('span')
    slash.classList.add('ft-caption-toggle-slash')
    slash.ariaHidden = 'true'
    this.button_.appendChild(slash)

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

    this.button_.ariaLabel = this.localization.resolve('CAPTIONS')
    this.button_.ariaPressed = captionsEnabled ? 'true' : 'false'
    this.button_.classList.toggle('shaka-hidden', tracks.length === 0)
  }
}
