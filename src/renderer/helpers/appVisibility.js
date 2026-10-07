// Android may keep Chromium active for a subscription refresh while its window
// is hidden. UI and playback must still follow the real activity visibility.
let androidVisible = null

export function isAppHidden() {
  return androidVisible === null
    ? typeof document !== 'undefined' && document.hidden
    : !androidVisible
}

/**
 * @param {AbortSignal} signal
 * @returns {Promise<boolean>} Whether the app became visible before cancellation.
 */
export function waitForAppVisible(signal) {
  if (signal.aborted) return Promise.resolve(false)
  if (!isAppHidden()) return Promise.resolve(true)
  return new Promise(resolve => {
    const finish = visible => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      signal.removeEventListener('abort', onAbort)
      resolve(visible)
    }
    const onVisibilityChange = () => {
      if (!isAppHidden()) finish(true)
    }
    const onAbort = () => finish(false)
    document.addEventListener('visibilitychange', onVisibilityChange)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function setAndroidAppVisible(visible) {
  const wasHidden = isAppHidden()
  androidVisible = visible
  if (wasHidden !== isAppHidden()) {
    document.dispatchEvent(new Event('visibilitychange'))
  }
}
