import { importWithStubs } from './module-stubs.mjs'

/** The URL `isOpenTubeXUrl` accepts outside development builds */
export const APP_URL = 'app://bundle/'

/**
 * A stand-in for Electron's `ipcMain` that records registrations, so tests
 * can call the real handlers.
 */
export function createIpcMainFake() {
  const handlers = new Map()
  const listeners = new Map()
  return {
    handlers,
    listeners,
    handle(channel, handler) { handlers.set(channel, handler) },
    on(channel, listener) { listeners.set(channel, listener) },
    once(channel, listener) { listeners.set(channel, listener) },
    /** @param {string} channel @param {object} event @param {...unknown} args */
    invoke(channel, event, ...args) { return handlers.get(channel)(event, ...args) },
    /** @param {string} channel @param {object} event @param {...unknown} args */
    send(channel, event, ...args) { return listeners.get(channel)(event, ...args) },
  }
}

/**
 * An IPC event from a frame at `url`.
 * @param {string} [url]
 * @param {object} [sender]
 */
export function ipcEvent(url = APP_URL, sender = {}) {
  return { senderFrame: { url }, sender }
}

const ELECTRON_EXPORTS = [
  'app', 'BaseWindow', 'BrowserWindow', 'clipboard', 'dialog', 'globalShortcut', 'ipcMain', 'Menu',
  'MessageChannelMain', 'nativeImage', 'nativeTheme', 'net', 'Notification', 'powerMonitor',
  'powerSaveBlocker', 'protocol', 'safeStorage', 'screen', 'session', 'ShareMenu', 'shell',
  'systemPreferences', 'Tray', 'utilityProcess', 'webContents', 'WebContentsView',
]

/**
 * Imports main-process modules with the `electron` module replaced by the
 * properties of `electron`; other Electron exports are undefined.
 * @param {string[]} urls Absolute module URLs
 * @param {Record<string, unknown>} electron
 * @param {Record<string, Record<string, unknown>>} [stubs] other replaced modules
 */
export function importWithElectron(urls, electron, stubs = {}) {
  return importWithStubs(urls, { ...stubs, electron }, { electron: ELECTRON_EXPORTS })
}
