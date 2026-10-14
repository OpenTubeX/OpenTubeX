/**
 * Native playback supplies Shaka only the browser's active cues. Shift those
 * cues before activation; the UI displayer must then use a zero delay.
 * @param {HTMLVideoElement} video
 * @param {() => number | null} getOffset null while playback uses MSE
 * @param {() => void} clearDisplayedCues discard Shaka's copies of old timings
 * @returns {{update: () => void, release: () => void}}
 */
export function bindNativeCaptionTiming(video, getOffset, clearDisplayedCues) {
  /** @type {WeakMap<TextTrackCue, {start: number, end: number}>} */
  const originals = new WeakMap()
  /** @type {WeakMap<TextTrack, {offset: number, length: number, first: TextTrackCue, last: TextTrackCue}>} */
  const tracks = new WeakMap()

  function update() {
    const offset = getOffset()
    if (offset === null) return
    let cleared = false
    for (const track of video.textTracks) {
      if (track.mode === 'disabled' || !['captions', 'subtitles'].includes(track.kind)) continue
      const cues = track.cues
      if (!cues?.length) continue
      const first = cues[0]
      const last = cues[cues.length - 1]
      const previous = tracks.get(track)
      // Avoid scanning long caption tracks on every playback tick.
      if (previous?.offset === offset && previous.length === cues.length &&
          previous.first === first && previous.last === last) continue
      if (!cleared) {
        clearDisplayedCues()
        cleared = true
      }
      // TextTrackCueList is live and reorders as start times change.
      for (const cue of Array.from(cues)) {
        if (!originals.has(cue)) originals.set(cue, { start: cue.startTime, end: cue.endTime })
        const original = originals.get(cue)
        cue.startTime = Math.max(0, original.start + offset)
        cue.endTime = Math.max(0, original.end + offset)
      }
      tracks.set(track, { offset, length: cues.length, first: cues[0], last: cues[cues.length - 1] })
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
