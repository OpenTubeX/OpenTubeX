import shaka from 'shaka-player'

import { appendMenuSwitch } from './menuSwitch'

/** Shaka's picture-in-picture button, with the player menu's switch for its state. */
export class PictureInPictureButton extends shaka.ui.PipButton {
  /**
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(parent, controls) {
    super(parent, controls)

    // Shaka appends the button last, and keeps it in a private field.
    /** @private */
    this.menuSwitch_ = appendMenuSwitch(/** @type {HTMLElement} */ (this.parent.lastElementChild))
  }

  release() {
    this.menuSwitch_.release()
    super.release()
  }
}
