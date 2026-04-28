import shaka from 'shaka-player'

export class LoopButton extends shaka.ui.Element {
  /**
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(parent, controls) {
    super(parent, controls)

    /** @private */
    this.loopEnabled_ = this.video.loop

    /** @private */
    this.statePoller_ = window.setInterval(() => {
      if (this.loopEnabled_ !== this.video.loop) {
        this.loopEnabled_ = this.video.loop
        this.updateLocalisedStrings_()
      }
    }, 250)

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('loop-button', 'shaka-no-propagation', 'shaka-tooltip')

    /** @private */
    this.icon_ = new shaka.ui.Icon(this.button_, shaka.ui.Enums.MaterialDesignSVGIcons.LOOP)

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
    this.currentState_.classList.add('shaka-current-selection-span')
    label.appendChild(this.currentState_)

    this.button_.appendChild(label)
    this.parent.appendChild(this.button_)

    this.eventManager.listen(this.button_, 'click', () => {
      this.video.loop = !this.video.loop
      this.loopEnabled_ = this.video.loop
      this.updateLocalisedStrings_()
    })

    this.eventManager.listenMulti(this.controls, ['contextmenu', 'submenuopen', 'submenuclose'], () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(this.localization, shaka.ui.Localization.LOCALE_CHANGED, () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(this.localization, shaka.ui.Localization.LOCALE_UPDATED, () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listenMulti(this.player, ['unloading', 'loaded', 'manifestupdated'], () => {
      this.updateVisibility_()
    })

    this.eventManager.listen(this.video, 'durationchange', () => {
      this.updateVisibility_()
    })

    this.updateVisibility_()
    this.updateLocalisedStrings_()
  }

  release() {
    window.clearInterval(this.statePoller_)
    super.release()
  }

  /** @private */
  updateLocalisedStrings_() {
    this.nameSpan_.textContent = this.localization.resolve('LOOP')
    this.currentState_.textContent = this.localization.resolve(this.video.loop ? 'ON' : 'OFF')
    this.icon_.use(this.video.loop
      ? shaka.ui.Enums.MaterialDesignSVGIcons.UNLOOP
      : shaka.ui.Enums.MaterialDesignSVGIcons.LOOP)
    this.button_.ariaLabel = this.localization.resolve(this.video.loop ? 'EXIT_LOOP_MODE' : 'ENTER_LOOP_MODE')
  }

  /** @private */
  updateVisibility_() {
    if (this.player.isLive()) {
      this.button_.classList.add('shaka-hidden')
    } else {
      this.button_.classList.remove('shaka-hidden')
    }
  }
}
