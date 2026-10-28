import shaka from 'shaka-player'
import i18n from '../../../i18n/index'
import { updateSponsorBlockSeekBarState } from '../../../helpers/player/sponsorBlockSeekBar'
import { SeekFilmstrip, THUMB_SIZE } from './SeekFilmstrip'

// Pointer movement after pressing the bar that turns a tap into a drag.
const DRAG_THRESHOLD = 4
// Distance from the thumb's center that still grabs it with a mouse.
const THUMB_GRAB_RADIUS = THUMB_SIZE / 2 + 2
// How much finer than the seek bar the filmstrip must be to offer precise seeking.
const PRECISE_MIN_ZOOM = 2

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
    /** @private @type {{ x: number, y: number } | null} */
    this.pointer = null
    /**
     * Like YouTube, pulling the pointer up onto the filmstrip scrubs at its scale.
     * @private @type {{ x: number, time: number, markerX: number, secondsPerPixel: number } | null}
     */
    this.precise = null
    /** @private */
    this.lastDragValue = 0
    /** @private */
    this.cancelTime = 0
    /** @private */
    this.cancelled = false

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
    // Shaka reads the pointer only for its x position, so track it before Shaka does.
    for (const type of ['mousemove', 'mouseup', 'touchmove', 'touchend']) {
      this.eventManager.listen(window, type, event => {
        const point = event.changedTouches?.[0] ?? event
        this.pointer = { x: point.clientX, y: point.clientY }
      }, true)
    }
    // Like YouTube's "Exit precise seeking", Escape returns to where the drag started.
    // Shaka ends a drag when the focused bar loses focus.
    this.eventManager.listen(window, 'keydown', event => {
      if (event.key !== 'Escape' || !this.filmstripShown || this.dragStartValue === null || document.activeElement !== this.bar) return
      event.preventDefault()
      event.stopPropagation()
      this.cancelled = true
      this.bar.blur()
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
    this.cancelTime = this.video.currentTime
    super.onChangeStart()
    this.dragStartValue = this.mouseGrabbedThumb === false ? null : this.getValue()
    this.lastDragValue = this.getValue()
  }

  // Notify after Shaka updates the preview text for mouse, touch and keyboard.
  onChange() {
    this.applyPreciseSeek()
    super.onChange()
    // A tap only seeks; dragging the thumb shows the filmstrip.
    if (this.dragStartValue !== null && !this.filmstripShown) {
      const range = Number(this.bar.max) - Number(this.bar.min)
      const distance = Math.abs(this.getValue() - this.dragStartValue) / range * this.bar.getBoundingClientRect().width
      this.filmstripShown = distance >= DRAG_THRESHOLD
    }
    if (this.filmstripShown) {
      // The strip's scale is only known once it has rendered.
      this.filmstrip.show(this.getValue(), this.precise?.markerX).then(() => this.updatePullHint())
    }
    this.controls.dispatchEvent(new shaka.util.FakeEvent('seekbarvaluechange', { time: this.getValue(), chapterX: this.precise?.markerX }))
    if (this.precise) {
      // Keep the time, now with any labels the event added, above the fixed marker.
      const preview = this.container.querySelector('.shaka-player-ui-thumbnail-container')
      const width = preview.clientWidth
      preview.style.left = `${Math.min(this.bar.offsetWidth - width, Math.max(0, this.precise.markerX - width / 2))}px`
      // Shaka centers and clamps the preview with a transform instead, so drop it while we position it
      preview.style.transform = ''
    }
    this.lastDragValue = this.getValue()
  }

  /** @private */
  updatePullHint() {
    const pullable = this.filmstripShown && !this.precise && this.isPreciseFiner()
    if (pullable) this.filmstrip.hint.textContent = i18n.global.t('Video.Player.Pull up for precise seeking')
    this.container.classList.toggle('ft-seek-filmstrip-pullable', pullable)
  }

  /**
   * Shaka has just set the value from the pointer's x position; while the
   * pointer is pulled up onto the filmstrip, move by the strip's scale instead.
   * @private
   */
  applyPreciseSeek() {
    if (!this.filmstripShown || this.dragStartValue === null || !this.pointer) return
    if (!this.precise) {
      const { pixelsPerSecond, element } = this.filmstrip
      if (!this.isPreciseFiner() || this.pointer.y >= element.getBoundingClientRect().bottom) return
      // Start where the previous move left the thumb: Shaka has already mapped this
      // move's x onto the bar, and the strip may still be rendering an older time.
      const time = this.lastDragValue
      const markerX = this.getThumbClientX(time) - this.bar.getBoundingClientRect().left
      this.precise = { x: this.pointer.x, time, markerX, secondsPerPixel: 1 / pixelsPerSecond }
    }
    const time = this.precise.time + (this.pointer.x - this.precise.x) * this.precise.secondsPerPixel
    this.bar.value = String(Math.min(Number(this.bar.max), Math.max(Number(this.bar.min), time)))
  }

  /**
   * Short storyboards with only a few frames leave the filmstrip no finer than the bar.
   * @private
   */
  isPreciseFiner() {
    const range = Number(this.bar.max) - Number(this.bar.min)
    const barPixelsPerSecond = (this.bar.getBoundingClientRect().width - THUMB_SIZE) / range
    return this.filmstrip.pixelsPerSecond >= barPixelsPerSecond * PRECISE_MIN_ZOOM
  }

  onChangeEnd() {
    if (this.cancelled) {
      this.bar.value = String(this.cancelTime)
    } else {
      this.applyPreciseSeek()
    }
    this.cancelled = false
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
    // The chapter title followed the precise time; the pointer may be far from the bar.
    const chapter = this.precise && this.container.querySelector('.ft-chapter-preview')
    if (chapter) chapter.style.display = 'none'
    this.pointer = null
    this.precise = null
    if (!this.filmstripShown) return
    this.filmstripShown = false
    this.container.classList.remove('ft-seek-filmstrip-pullable')
    this.filmstrip.hide()
    // Hide the time with the filmstrip instead of letting it drop to the bar.
    const preview = this.container.querySelector('.shaka-player-ui-thumbnail-container')
    if (preview) preview.style.visibility = 'hidden'
  }
}

shaka.ui.Controls.registerSeekBar({
  create: (parent, controls) => new SeekPreviewBar(parent, controls),
})
