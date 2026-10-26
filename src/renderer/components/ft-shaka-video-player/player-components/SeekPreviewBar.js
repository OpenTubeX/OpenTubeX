import shaka from 'shaka-player'
import { updateSponsorBlockSeekBarState } from '../../../helpers/player/sponsorBlockSeekBar'
import { SeekFilmstrip, THUMB_SIZE } from './SeekFilmstrip'

// Pointer movement after pressing the bar that turns a tap into a drag.
const DRAG_THRESHOLD = 4
// Distance from the thumb's centre that still grabs it with a mouse.
const THUMB_GRAB_RADIUS = THUMB_SIZE / 2 + 2

export class SeekPreviewBar extends shaka.ui.SeekBar {
  constructor(parent, controls) {
    super(parent, controls)
    /** @private @type {number | null} */
    this.previewTime = null
    /** @private @type {number | null} */
    this.dragStartValue = null
    /** @private @type {boolean | null} */
    this.mouseGrabbedThumb = null
    /** @private */
    this.filmstripShown = false
    /** @private */
    this.filmstrip = new SeekFilmstrip(this)

    this.eventManager.listen(controls, 'seekpreviewchange', event => {
      const wasPreviewing = this.previewTime !== null
      this.previewTime = event.time
      // Reveal the controls before seeking starts: Shaka only keeps them up for
      // a paused video while it is not seeking, and the touch has not moved yet.
      if (!wasPreviewing && this.previewTime !== null) controls.showUI()
      controls.setSeeking(this.previewTime !== null)
      this.setValue(this.previewTime ?? this.video.currentTime)
      this.update()
      if (this.previewTime !== null && event.showPreview) {
        this.showSeekPreview()
      } else {
        this.hideSeekPreview()
      }
    })
    this.eventManager.listen(this.player, 'unloading', () => this.hideSeekPreview())
    // Like YouTube, a mouse only shows the filmstrip while dragging the thumb
    // itself. Capture the press before Shaka moves the thumb to the pointer.
    this.eventManager.listen(this.container, 'mousedown', event => {
      this.mouseGrabbedThumb = Math.abs(event.clientX - this.getThumbClientX(this.getValue())) <= THUMB_GRAB_RADIUS
    }, true)
  }

  /**
   * Playback updates must not move the thumb away from the gesture's target.
   * @param {number} time
   */
  setValue(time) {
    super.setValue(this.previewTime ?? time)
  }

  update() {
    super.update()
    updateSponsorBlockSeekBarState(this.container)
  }

  onChangeStart() {
    super.onChangeStart()
    this.dragStartValue = this.mouseGrabbedThumb === false ? null : this.getValue()
  }

  // Notify after Shaka updates the preview text for mouse, touch and keyboard.
  onChange() {
    super.onChange()
    // A tap only seeks; dragging the thumb shows the filmstrip.
    if (this.dragStartValue !== null && !this.filmstripShown) {
      const range = Number(this.bar.max) - Number(this.bar.min)
      const distance = Math.abs(this.getValue() - this.dragStartValue) / range * this.bar.getBoundingClientRect().width
      this.filmstripShown = distance >= DRAG_THRESHOLD
    }
    if (this.filmstripShown) this.filmstrip.show(this.getValue())
    this.controls.dispatchEvent(new shaka.util.FakeEvent('seekbarvaluechange', { time: this.getValue() }))
  }

  onChangeEnd() {
    super.onChangeEnd()
    this.dragStartValue = null
    this.mouseGrabbedThumb = null
    this.hideSeekPreview()
  }

  /** @private */
  showSeekPreview() {
    const time = this.getValue()
    // Shaka only exposes its time preview through hovering, so hover the thumb.
    // MouseEvent truncates clientX to whole pixels, which can be seconds apart.
    // Aim a millisecond late: converting back from pixels can land just below
    // a whole second, which Shaka's label would round down.
    const hover = new MouseEvent('mousemove')
    Object.defineProperty(hover, 'clientX', { value: this.getThumbClientX(time + 0.001) })
    this.bar.dispatchEvent(hover)
    this.filmstripShown = true
    this.filmstrip.show(time)
    this.controls.dispatchEvent(new shaka.util.FakeEvent('seekbarvaluechange', { time }))
  }

  /**
   * @private
   * @param {number} time
   */
  getThumbClientX(time) {
    const rect = this.bar.getBoundingClientRect()
    const min = Number(this.bar.min)
    const max = Number(this.bar.max)
    const fraction = max > min ? (time - min) / (max - min) : 0
    return rect.left + THUMB_SIZE / 2 + fraction * (rect.width - THUMB_SIZE)
  }

  /** @private */
  hideSeekPreview() {
    if (!this.filmstripShown) return
    this.filmstripShown = false
    this.filmstrip.hide()
    // Hide the time with the filmstrip instead of letting it drop to the bar.
    const preview = this.container.querySelector('.shaka-player-ui-thumbnail-container')
    if (preview) preview.style.visibility = 'hidden'
  }
}

shaka.ui.Controls.registerSeekBar({
  create: (parent, controls) => new SeekPreviewBar(parent, controls),
})
