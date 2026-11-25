// @ts-check
import { nativeTheme } from 'electron'
import dbus from 'dbus-native'

const NAMESPACE = 'org.freedesktop.appearance'
const KEY = 'color-scheme'
// Window creation waits at most this long for a portal that is slow to answer.
const READ_TIMEOUT = 1000

/** @type {Promise<boolean | null> | null} */
let portalPrefersDark = null
let nativeThemeUpdated = false

/**
 * Chromium on Linux asks the XDG settings portal for the desktop's color
 * scheme only once the app is ready. Until the answer arrives, Electron 45
 * reports light colors, so the first window could paint its splash light on a
 * dark desktop. Ask the portal directly, before the app is ready.
 */
export function readStartupColorScheme() {
  if (process.platform !== 'linux' || portalPrefersDark) return
  // Once Chromium has heard from the portal, or the scheme changed, it is current.
  nativeTheme.once('updated', () => { nativeThemeUpdated = true })
  portalPrefersDark = new Promise(resolve => {
    /** @type {ReturnType<typeof dbus.sessionBus> | null} */
    let bus = null
    /** @param {boolean | null} dark */
    const finish = (dark) => {
      clearTimeout(timer)
      bus?.connection.end()
      resolve(dark)
    }
    const timer = setTimeout(() => finish(null), READ_TIMEOUT)
    try {
      // Throws synchronously without a session bus address
      bus = dbus.sessionBus({ timeout: READ_TIMEOUT })
      bus.connection.on('error', () => finish(null))
      bus.getService('org.freedesktop.portal.Desktop')
        .getInterface('/org/freedesktop/portal/desktop', 'org.freedesktop.portal.Settings')
        // Version 1 portals lack ReadOne, and dbus-native unwraps the nested variant Read returns.
        .then(settings => settings.Read(NAMESPACE, KEY))
        // 0 means no preference, which leaves the choice to Chromium.
        .then(value => finish(value === 1 ? true : value === 2 ? false : null), () => finish(null))
    } catch {
      finish(null)
    }
  })
}

/**
 * Whether a new window should start in dark colors, before its renderer can
 * follow the system itself.
 * @returns {Promise<boolean>}
 */
export async function systemPrefersDark() {
  if (portalPrefersDark && !nativeThemeUpdated && nativeTheme.themeSource === 'system') {
    const dark = await portalPrefersDark
    if (dark !== null && !nativeThemeUpdated) return dark
  }
  return nativeTheme.shouldUseDarkColors
}
