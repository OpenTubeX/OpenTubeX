/** Prepare PiP while UIKit is resigning activity, before WebKit suspends video. */
export function bindIosAutoPictureInPicture({ getVideo, isEnabled, target = window }) {
  const enter = () => {
    const video = getVideo()
    if (!isEnabled() || !video || video.paused || video.ended ||
        video.webkitPresentationMode === 'picture-in-picture' ||
        !video.webkitSupportsPresentationMode?.('picture-in-picture')) return
    try {
      video.webkitSetPresentationMode('picture-in-picture')
    } catch (error) {
      console.warn('Could not enter iOS Picture-in-Picture:', error)
    }
  }
  target.addEventListener('opentubex:prepare-background', enter)
  return () => target.removeEventListener('opentubex:prepare-background', enter)
}
