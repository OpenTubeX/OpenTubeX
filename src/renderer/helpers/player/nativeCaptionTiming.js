/**
 * Native playback supplies Shaka only the browser's active cues. Shift those
 * cues before activation; the UI displayer must then use a zero delay.
 * @param {HTMLVideoElement} video
 * @param {() => number | null} getOffset null while playback uses MSE
 * @param {() => void} clearDisplayedCues discard Shaka's copies of old timings
 * @returns {{update: () => void, release: () => void}}
 */
export function bindNativeCaptionTiming(video, getOffset, clearDisplayedCues) {
  /** @type {WeakMap<TextTrackCue, {start: number, end: number, appliedStart: number, appliedEnd: number}>} */
  const originals = new WeakMap()
  /** @type {WeakMap<TextTrack, {offset: number, cues: TextTrackCue[]}>} */
  const tracks = new WeakMap()

  function update() {
    const offset = getOffset()
    if (offset === null) return
    let cleared = false
    for (const track of video.textTracks) {
      if (track.mode === 'disabled' || !['captions', 'subtitles'].includes(track.kind)) continue
      const cues = track.cues
      if (!cues?.length) continue
      // Snapshot the live list before cue timing changes can reorder it.
      const snapshot = Array.from(cues)
      const previous = tracks.get(track)
      if (previous?.offset === offset && previous.cues.length === snapshot.length &&
          snapshot.every((cue, index) => {
            const original = originals.get(cue)
            return previous.cues[index] === cue && original?.appliedStart === cue.startTime &&
              original.appliedEnd === cue.endTime
          })) continue
      if (!cleared) {
        clearDisplayedCues()
        cleared = true
      }
      for (const cue of snapshot) {
        let original = originals.get(cue)
        if (!original) {
          original = { start: cue.startTime, end: cue.endTime, appliedStart: cue.startTime, appliedEnd: cue.endTime }
          originals.set(cue, original)
        } else {
          // Preserve source retiming without applying our offset a second time.
          if (cue.startTime !== original.appliedStart) original.start = cue.startTime
          if (cue.endTime !== original.appliedEnd) original.end = cue.endTime
        }
        original.appliedStart = Math.max(0, original.start + offset)
        original.appliedEnd = Math.max(0, original.end + offset)
        cue.startTime = original.appliedStart
        cue.endTime = original.appliedEnd
      }
      tracks.set(track, { offset, cues: Array.from(cues) })
      track.dispatchEvent(new Event('cuechange'))
    }
  }

  video.addEventListener('load', update, true)
  video.addEventListener('timeupdate', update)
  video.addEventListener('seeked', update)
  video.textTracks.addEventListener('addtrack', update)
  video.textTracks.addEventListener('change', update)
  update()

  return {
    update,
    release() {
      video.removeEventListener('load', update, true)
      video.removeEventListener('timeupdate', update)
      video.removeEventListener('seeked', update)
      video.textTracks.removeEventListener('addtrack', update)
      video.textTracks.removeEventListener('change', update)
      for (const track of video.textTracks) {
        for (const cue of Array.from(track.cues ?? [])) {
          const original = originals.get(cue)
          if (original) {
            cue.startTime = original.start
            cue.endTime = original.end
          }
        }
      }
    }
  }
}
