// Android may keep Chromium active for a subscription refresh while its window
// is hidden. UI and playback must still follow the real activity visibility.
let androidVisible = null

export function isAppHidden() {
  return androidVisible === null
    ? typeof document !== 'undefined' && document.hidden
    : !androidVisible
}

export function setAndroidAppVisible(visible) {
  const wasHidden = isAppHidden()
  androidVisible = visible
  if (wasHidden !== isAppHidden()) {
    document.dispatchEvent(new Event('visibilitychange'))
  }
}
