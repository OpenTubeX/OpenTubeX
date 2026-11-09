// @ts-check
import { execFile } from 'node:child_process'
import dbus from 'dbus-native'

const NAMESPACE = 'org.freedesktop.appearance'
const KEY = 'color-scheme'
// The portal can still be starting when the app opens into the tray at login.
const RETRY_DELAYS = [3_000, 10_000, 30_000]
// Windows announces no taskbar-only theme change that Electron exposes, so poll it.
const WINDOWS_POLL_INTERVAL = 10_000

/**
 * Watches whether the taskbar or panel is dark, so a monochrome tray icon can
 * contrast with it. macOS needs no watcher because it recolors template images.
 *
 * The app forces `nativeTheme.themeSource` to its own theme, and Electron only
 * refreshes the taskbar theme when the app theme changes. So Windows reads the
 * taskbar theme from the registry and Linux asks the XDG settings portal. Linux
 * exposes no panel color, so the desktop color scheme stands in for it. Without
 * a light preference the panel counts as dark, like GNOME's top bar.
 * @param {(dark: boolean) => void} onChange called with the initial value and on changes
 * @returns {() => void} stop watching
 */
export function watchTrayColorScheme(onChange) {
  let stopped = false
  onChange(true)
  if (process.platform === 'win32') {
    const read = () => execFile('reg', [
      'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'SystemUsesLightTheme'
    ], { windowsHide: true }, (error, stdout) => {
      // Windows versions without light taskbars lack the value.
      if (!stopped) onChange(error !== null || !/SystemUsesLightTheme\s+REG_DWORD\s+0x1\b/.test(stdout))
    })
    read()
    const timer = setInterval(read, WINDOWS_POLL_INTERVAL)
    timer.unref?.()
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }

  if (process.platform !== 'linux') return () => {}

  let failedReads = 0
  /** @type {ReturnType<typeof dbus.sessionBus> | null} */
  let bus = null
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let retryTimer

  /** @param {unknown} value */
  const publish = value => onChange(value !== 2)

  async function connect() {
    let signalled = false
    try {
      // Throws synchronously without a session bus address
      bus = dbus.sessionBus({ timeout: 2_000 })
      bus.connection.on('error', () => {})
      const settings = await bus.getService('org.freedesktop.portal.Desktop')
        .getInterface('/org/freedesktop/portal/desktop', 'org.freedesktop.portal.Settings')
      if (stopped) return
      settings.on('SettingChanged', (namespace, key, value) => {
        if (namespace !== NAMESPACE || key !== KEY) return
        signalled = true
        publish(value)
      })
      const value = await settings.ReadOne(NAMESPACE, KEY)
      // The portal can signal a change before it answers the read, so the signal is newer
      if (!signalled && !stopped) publish(value)
    } catch {
      bus?.connection.end()
      bus = null
      if (!stopped && failedReads < RETRY_DELAYS.length) {
        retryTimer = setTimeout(connect, RETRY_DELAYS[failedReads++])
        retryTimer.unref?.()
      }
    }
  }

  connect()
  return () => {
    stopped = true
    clearTimeout(retryTimer)
    bus?.connection.end()
  }
}
