/**
 * Android WebView can deliver an error event while video.error is null.
 * Shaka rejects an in-flight load even without a MediaError.
 * Keep those stale events out of the new load, but deliver actual failures.
 * @param {HTMLVideoElement} video
 * @returns {() => void}
 */
export function bindAndroidMediaErrors(video) {
  const handleError = event => {
    if (event.target === video && video.error === null) {
      event.stopImmediatePropagation()
    }
  }
  video.addEventListener('error', handleError, { capture: true })
  return () => video.removeEventListener('error', handleError, { capture: true })
}
