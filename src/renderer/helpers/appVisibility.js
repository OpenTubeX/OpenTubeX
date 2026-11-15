// Android may keep Chromium active for a subscription refresh while its window
// is hidden. UI and playback must still follow the real activity visibility.
let androidVisible = null
// Starting a new playback service requires the immediate native activity
// state, without the UI's PiP/launcher visibility grace period.
let androidActive = null

/** @returns {boolean|null} Native activity state, or null before its initial snapshot. */
export function getAndroidAppActive() {
  return androidActive
}

/** @param {boolean|null} active */
export function setAndroidAppActive(active) {
  if (androidActive === active) return
  androidActive = active
  document.dispatchEvent(new Event('opentubex:android-app-active-change'))
}

export function isAppHidden() {
  return androidVisible === null
    ? typeof document !== 'undefined' && document.hidden
    : !androidVisible
}

/**
 * @param {AbortSignal} signal
 * @param {boolean|null} previousState
 * @returns {Promise<boolean|null>} The next native state, or null on cancellation.
 */
export function waitForAndroidAppState(signal, previousState) {
  if (signal.aborted) return Promise.resolve(null)
  if (androidActive !== previousState) return Promise.resolve(androidActive)
  return new Promise(resolve => {
    const finish = state => {
      document.removeEventListener('opentubex:android-app-active-change', onActivityChange)
      signal.removeEventListener('abort', onAbort)
      resolve(state)
    }
    const onActivityChange = () => {
      if (androidActive !== previousState) finish(androidActive)
    }
    const onAbort = () => finish(null)
    document.addEventListener('opentubex:android-app-active-change', onActivityChange)
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
