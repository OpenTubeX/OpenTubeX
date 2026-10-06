import shaka from 'shaka-player'

export class SeekPreviewBar extends shaka.ui.SeekBar {
  constructor(parent, controls) {
    super(parent, controls)
    /** @private @type {number | null} */
    this.previewTime = null

    this.eventManager.listen(controls, 'seekpreviewchange', event => {
      const wasPreviewing = this.previewTime !== null
      this.previewTime = event.time
      controls.setSeeking(this.previewTime !== null)
      if (!wasPreviewing && this.previewTime !== null) controls.showUI()
      this.setValue(this.previewTime ?? this.video.currentTime)
      this.update()
    })
  }

  /**
   * Playback updates must not move the thumb away from the gesture's target.
   * @param {number} time
   */
  setValue(time) {
    super.setValue(this.previewTime ?? time)
  }
}

shaka.ui.Controls.registerSeekBar({
  create: (parent, controls) => new SeekPreviewBar(parent, controls),
})
