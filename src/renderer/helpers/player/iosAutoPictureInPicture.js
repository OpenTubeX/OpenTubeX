// WebKit reports the new presentation mode only once the transition starts,
// after the app already reported that it is going to the background.
const enteringVideos = new WeakSet()

/** @param {HTMLVideoElement | null | undefined} video */
export function isEnteringIosPictureInPicture(video) {
  return !!video && enteringVideos.has(video)
}

/** Prepare PiP while UIKit is resigning activity, before WebKit suspends video. */
export function bindIosAutoPictureInPicture({ getVideo, isEnabled, target = window }) {
  const enter = () => {
    const video = getVideo()
    // A request that WebKit dropped without a mode change must not outlast it.
    if (video) enteringVideos.delete(video)
    if (!isEnabled() || !video || video.paused || video.ended ||
        video.webkitPresentationMode === 'picture-in-picture' ||
        !video.webkitSupportsPresentationMode?.('picture-in-picture')) return
    try {
      video.webkitSetPresentationMode('picture-in-picture')
      enteringVideos.add(video)
      video.addEventListener('webkitpresentationmodechanged', () => enteringVideos.delete(video), { once: true })
    } catch (error) {
      console.warn('Could not enter iOS Picture-in-Picture:', error)
    }
  }
  target.addEventListener('opentubex:prepare-background', enter)
  return () => target.removeEventListener('opentubex:prepare-background', enter)
}
