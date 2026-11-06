// Covers a cold browser start. Windows also lifts the lock when the user
// presses Alt or activates another window.
const FOREGROUND_LOCK_MS = 5000

let lockedNative = null
let unlockTimeout = null

/**
 * Lets the browser take the foreground again, for links opened normally
 * while a background link still holds the lock.
 */
export function releaseForegroundLock() {
  clearTimeout(unlockTimeout)
  lockedNative?.lockForeground(false)
  lockedNative = null
}

/**
 * Creates a function that opens a URL in the default browser while the app
 * stays in front.
 *
 * macOS supports this directly. On Windows, a browser that is already
 * running takes the foreground, and Windows refuses to give it back to
 * BrowserWindow.focus(), so the foreground is locked before launching the
 * browser instead. Linux has no equivalent, so the browser's activation
 * depends on the compositor's focus stealing prevention.
 * @param {object} options
 * @param {NodeJS.Platform} options.platform
 * @param {(url: string, options: Electron.OpenExternalOptions) => Promise<void>} options.openExternal
 * @param {() => { lockForeground: (locked: boolean) => boolean }} options.loadWindowsNative
 */
export function createBackgroundExternalLinkOpener({ platform, openExternal, loadWindowsNative }) {
  /** @param {string} url */
  return async url => {
    if (platform === 'win32') {
      try {
        const native = loadWindowsNative()
        native.lockForeground(true)
        lockedNative = native
        clearTimeout(unlockTimeout)
        unlockTimeout = setTimeout(releaseForegroundLock, FOREGROUND_LOCK_MS)
      } catch (error) {
        // Still open the link, even if the browser then comes to the front.
        console.error('Failed to lock the foreground window:', error)
      }
    }

    // `activate` only has an effect on macOS.
    await openExternal(url, { activate: false })
  }
}
