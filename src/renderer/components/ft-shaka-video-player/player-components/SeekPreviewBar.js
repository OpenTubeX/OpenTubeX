import shaka from 'shaka-player'
import i18n from '../../../i18n/index'
import { updateSponsorBlockSeekBarState } from '../../../helpers/player/sponsorBlockSeekBar'
import { SeekFilmstrip, THUMB_SIZE } from './SeekFilmstrip'

// Pointer movement after pressing the bar that turns a tap into a drag.
const DRAG_THRESHOLD = 4
// How much finer than the seek bar the filmstrip must be to offer precise seeking.
const PRECISE_MIN_ZOOM = 2

export class SeekPreviewBar extends shaka.ui.SeekBar {
  constructor(parent, controls) {
    super(parent, controls)
    /** @private @type {number | null} */
    this.previewTime = null
    /** @private @type {number | null} */
    this.dragStartValue = null
    /** @private */
    this.mousePressed = false
    /**
     * The controls' own setting while a mouse drag keeps them shown.
     * @private @type {boolean | null}
     */
    this.showUIAlways = null
    /** @private */
    this.filmstripShown = false
    /** @private */
    this.filmstrip = new SeekFilmstrip(this)
    /** @private @type {{ x: number, y: number } | null} */
    this.pointer = null
    /**
     * Like YouTube, pulling the pointer up past the filmstrip's middle scrubs at its scale.
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
    this.eventManager.listen(this.container, 'mousedown', () => {
      this.mousePressed = true
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

  onChangeStart(fromTouchEvent) {
    this.cancelTime = this.video.currentTime
    super.onChangeStart(fromTouchEvent)
    this.dragStartValue = this.getValue()
    this.lastDragValue = this.getValue()
    if (this.mousePressed) {
      // Keep the controls up while dragging, even when the pointer leaves the player or rests.
      const config = this.controls.getConfig()
      this.showUIAlways = config.showUIAlways
      config.showUIAlways = true
    }
    this.mousePressed = false
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
      this.filmstrip.show(this.getValue(), this.precise?.markerX).then(() => this.updateHint())
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
  updateHint() {
    const available = this.filmstripShown && this.isPreciseFiner()
    if (available) {
      this.filmstrip.hint.textContent = this.precise
        ? i18n.global.t('Video.Player.Precise seeking, drag down to exit')
        : i18n.global.t('Video.Player.Pull up for precise seeking')
    }
    this.container.classList.toggle('ft-seek-filmstrip-pullable', available)
    this.container.classList.toggle('ft-seek-filmstrip-precise', available && this.precise !== null)
  }

  /**
   * Shaka has just set the value from the pointer's x position; while the
   * pointer is pulled up onto the filmstrip, move by the strip's scale instead.
   * @private
   */
  applyPreciseSeek() {
    if (!this.filmstripShown || this.dragStartValue === null || !this.pointer) return
    const strip = this.filmstrip.element.getBoundingClientRect()
    // Dragging back below the strip returns to Shaka's value from the pointer's x position.
    // Starting higher up than that leaves room to move without toggling back and forth.
    if (this.precise && this.pointer.y >= strip.bottom) {
      this.exitPreciseSeek()
      return
    }
    if (!this.precise) {
      if (!this.isPreciseFiner() || this.pointer.y > strip.top + strip.height / 2) return
      const { pixelsPerSecond } = this.filmstrip
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
    this.hideSeekPreview()
    if (this.showUIAlways !== null) {
      this.controls.getConfig().showUIAlways = this.showUIAlways
      this.showUIAlways = null
      // Hide as if the pointer had just left when the drag ends outside the player.
      if (this.controls.getVideoContainer().matches(':hover')) {
        this.controls.showUI()
      } else {
        this.controls.hideUI()
      }
    }
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
  exitPreciseSeek() {
    if (!this.precise) return
    this.precise = null
    // The chapter title followed the precise time; the pointer may be far from the bar.
    const chapter = this.container.querySelector('.ft-chapter-preview')
    if (chapter) chapter.style.display = 'none'
  }

  /** @private */
  hideSeekPreview() {
    this.exitPreciseSeek()
    this.pointer = null
    if (!this.filmstripShown) return
    this.filmstripShown = false
    this.container.classList.remove('ft-seek-filmstrip-pullable', 'ft-seek-filmstrip-precise')
    this.filmstrip.hide()
    // Hide the time with the filmstrip instead of letting it drop to the bar.
    const preview = this.container.querySelector('.shaka-player-ui-thumbnail-container')
    if (preview) preview.style.visibility = 'hidden'
  }
}

shaka.ui.Controls.registerSeekBar({
  create: (parent, controls) => new SeekPreviewBar(parent, controls),
})
