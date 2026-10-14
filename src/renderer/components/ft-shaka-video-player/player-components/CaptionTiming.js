import shaka from 'shaka-player'
import { h, render } from 'vue'
import { FtIcon } from '@opentubex/icons'

import i18n from '../../../i18n/index'
import { addOverlayScrollbars, clampOverlayScrollTop, removeOverlayScrollbars, restoreOverlayScrollTop } from '../../../helpers/overlayScrollbars'

export class CaptionTiming extends shaka.ui.Element {
  /**
   * @param {EventTarget} events
   * @param {{getOffset: () => number, setOffset: (offset: number) => void}} timing
   * @param {HTMLElement} captionMenu
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(events, timing, captionMenu, parent, controls) {
    super(parent, controls)
    this.timing_ = timing
    this.iconContainers_ = []
    this.scrollbarFrame_ = 0

    const action = this.createButton_('clock')
    this.button = action.button
    this.button.classList.add('ft-caption-timing-button')
    this.actionLabel_ = action.label

    this.menu_ = document.createElement('div')
    this.menu_.classList.add('shaka-no-propagation', 'shaka-show-controls-on-mouse-over',
      'shaka-hidden', 'ft-caption-timing-menu', this.isSubMenu ? 'shaka-sub-menu' : 'shaka-settings-menu')
    ;(this.isSubMenu ? parent : controls.getControlsContainer()).appendChild(this.menu_)

    const back = { button: document.createElement('button'), label: document.createElement('span') }
    back.button.type = 'button'
    back.button.classList.add('shaka-back-to-overflow-button')
    new shaka.ui.Icon(back.button, shaka.ui.Enums.MaterialDesignSVGIcons.BACK)
      .getSvgElement().setAttribute('aria-hidden', 'true')
    back.button.appendChild(back.label)
    this.backButton_ = back.button
    this.backLabel_ = back.label
    this.menu_.appendChild(back.button)

    const content = document.createElement('div')
    content.classList.add('ft-caption-timing-content')
    this.scroller_ = document.createElement('div')
    this.scroller_.classList.add('ft-caption-timing-controls')
    this.scroller_.appendChild(content)
    this.menu_.appendChild(this.scroller_)
    this.contentObserver_ = new ResizeObserver(() => {
      if (!this.menu_.classList.contains('shaka-hidden')) {
        clampOverlayScrollTop(this.scroller_, content)
      }
    })
    this.contentObserver_.observe(content)
    this.contentObserver_.observe(this.scroller_)

    const inputLabel = document.createElement('label')
    inputLabel.classList.add('ft-caption-timing-offset')
    this.offsetLabel_ = document.createElement('span')
    this.input_ = document.createElement('input')
    this.input_.type = 'number'
    this.input_.step = '0.1'
    this.input_.inputMode = 'decimal'
    inputLabel.append(this.offsetLabel_, this.input_)
    content.appendChild(inputLabel)

    this.hint_ = document.createElement('p')
    content.appendChild(this.hint_)

    const adjustments = document.createElement('div')
    adjustments.classList.add('ft-caption-timing-adjustments')
    content.appendChild(adjustments)
    const earlier = this.createButton_('minus')
    const later = this.createButton_('plus')
    this.earlierLabel_ = earlier.label
    this.laterLabel_ = later.label
    adjustments.append(earlier.button, later.button)

    const reset = this.createButton_('undo')
    this.resetLabel_ = reset.label
    content.appendChild(reset.button)

    this.eventManager.listen(this.button, 'click', event => {
      event.stopPropagation()
      this.updateOffset_()
      captionMenu.classList.add('shaka-hidden')
      this.menu_.classList.remove('shaka-hidden')
      restoreOverlayScrollTop(captionMenu.parentElement, 0)
      back.button.focus({ preventScroll: true })
      cancelAnimationFrame(this.scrollbarFrame_)
      this.scrollbarFrame_ = requestAnimationFrame(() => {
        this.scrollbarFrame_ = 0
        addOverlayScrollbars(this.scroller_)
        restoreOverlayScrollTop(this.scroller_, 0)
      })
    })
    this.eventManager.listen(this.menu_, 'click', event => event.stopPropagation())
    this.eventManager.listen(back.button, 'click', () => {
      this.menu_.classList.add('shaka-hidden')
      captionMenu.classList.remove('shaka-hidden')
      this.button.focus({ preventScroll: true })
    })
    this.eventManager.listen(this.controls, 'submenuclose', () => this.menu_.classList.add('shaka-hidden'))
    this.eventManager.listen(this.input_, 'input', () => {
      const offset = this.input_.valueAsNumber
      this.input_.ariaInvalid = Number.isFinite(offset) ? 'false' : 'true'
      if (Number.isFinite(offset)) this.timing_.setOffset(offset)
    })
    this.eventManager.listen(this.input_, 'change', () => this.updateOffset_())
    this.eventManager.listen(earlier.button, 'click', () => this.adjust_(-0.1))
    this.eventManager.listen(later.button, 'click', () => this.adjust_(0.1))
    this.eventManager.listen(reset.button, 'click', () => {
      this.timing_.setOffset(0)
      this.updateOffset_()
    })
    this.eventManager.listen(events, 'localeChanged', () => this.updateStrings_())
    this.eventManager.listen(events, 'captionTimingChanged', () => {
      if (document.activeElement !== this.input_) this.updateOffset_()
    })
    this.updateStrings_()
    this.updateOffset_()
  }

  /** @param {string} icon */
  createButton_(icon) {
    const button = document.createElement('button')
    button.type = 'button'
    const iconContainer = document.createElement('span')
    render(h(FtIcon, { icon, 'aria-hidden': 'true' }), iconContainer)
    this.iconContainers_.push(iconContainer)
    const label = document.createElement('span')
    button.append(iconContainer, label)
    return { button, label }
  }

  /** @param {number} amount */
  adjust_(amount) {
    // Round only the step operation to avoid accumulating floating point error.
    this.timing_.setOffset(Math.round((this.timing_.getOffset() + amount) * 1000) / 1000)
    this.updateOffset_()
  }

  updateOffset_() {
    this.input_.value = String(this.timing_.getOffset())
    this.input_.ariaInvalid = 'false'
  }

  updateStrings_() {
    const title = i18n.global.t('Video.Player.Caption Timing.Caption Timing')
    this.actionLabel_.textContent = i18n.global.t('Video.Player.Caption Timing.Adjust Timing')
    this.backLabel_.textContent = title
    this.backButton_.ariaLabel = this.localization.resolve('BACK')
    this.offsetLabel_.textContent = i18n.global.t('Video.Player.Caption Timing.Offset')
    this.hint_.textContent = i18n.global.t('Video.Player.Caption Timing.Hint')
    this.earlierLabel_.textContent = i18n.global.t('Video.Player.Caption Timing.Earlier')
    this.laterLabel_.textContent = i18n.global.t('Video.Player.Caption Timing.Later')
    this.resetLabel_.textContent = i18n.global.t('Video.Player.Caption Timing.Reset')
  }

  release() {
    this.contentObserver_.disconnect()
    cancelAnimationFrame(this.scrollbarFrame_)
    removeOverlayScrollbars(this.scroller_)
    for (const container of this.iconContainers_) render(null, container)
    this.button.remove()
    this.menu_.remove()
    super.release()
  }
}
