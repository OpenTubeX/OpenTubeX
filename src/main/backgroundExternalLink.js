// Covers a cold browser start; user input releases the lock earlier.
const FOREGROUND_LOCK_MS = 5000

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
  let unlockTimeout = null

  /** @param {string} url */
  return async url => {
    if (platform === 'win32') {
      try {
        const native = loadWindowsNative()
        native.lockForeground(true)
        clearTimeout(unlockTimeout)
        unlockTimeout = setTimeout(() => native.lockForeground(false), FOREGROUND_LOCK_MS)
      } catch (error) {
        // Still open the link, even if the browser then comes to the front.
        console.error('Failed to lock the foreground window:', error)
      }
    }

    // `activate` only has an effect on macOS.
    await openExternal(url, { activate: false })
  }
}
