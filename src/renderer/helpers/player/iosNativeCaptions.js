/**
 * WebKit can update native activeCues without notifying Shaka's UI displayer.
 * Refresh only changed hidden caption cues; native fullscreen/PiP stays native.
 * @param {HTMLVideoElement} video
 * @returns {() => void}
 */
export function bindIosNativeCaptions(video) {
  /** @type {TextTrack | undefined} */
  let previousTrack
  /** @type {TextTrackCue[]} */
  let previousCues = []

  function syncCues() {
    const track = Array.from(video.textTracks).find(track =>
      track.mode === 'hidden' && (track.kind === 'captions' || track.kind === 'subtitles'))
    const cues = Array.from(track?.activeCues ?? [])
    if (track === previousTrack && cues.length === previousCues.length &&
        cues.every((cue, index) => cue === previousCues[index])) return

    previousTrack = track
    previousCues = cues
    track?.dispatchEvent(new Event('cuechange'))
  }

  video.addEventListener('timeupdate', syncCues)
  video.addEventListener('seeked', syncCues)
  return () => {
    video.removeEventListener('timeupdate', syncCues)
    video.removeEventListener('seeked', syncCues)
  }
}
