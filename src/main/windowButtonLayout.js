import dbus from 'dbus-native'

const SETTINGS_NAMESPACE = 'org.gnome.desktop.wm.preferences'
const SETTINGS_KEY = 'button-layout'
const DEFAULT_BUTTON_LAYOUT = ':minimize,maximize,close'

/** @type {Promise<string> | null} */
let buttonLayout = null
/** @type {Set<(layout: string) => void>} */
const listeners = new Set()

/**
 * Reads the title bar button layout in GTK's format, such as
 * `close,minimize,maximize:`. The XDG settings portal provides it on GNOME and
 * translates KWin's button settings on Plasma, inside Flatpak too.
 * @returns {Promise<string>}
 */
async function readButtonLayout() {
  try {
    const bus = dbus.sessionBus({ timeout: 2_000 })
    bus.connection.on('error', () => {})
    const settings = await bus.getService('org.freedesktop.portal.Desktop')
      .getInterface('/org/freedesktop/portal/desktop', 'org.freedesktop.portal.Settings')
    settings.on('SettingChanged', (namespace, key, value) => {
      if (namespace !== SETTINGS_NAMESPACE || key !== SETTINGS_KEY || typeof value !== 'string') return
      buttonLayout = Promise.resolve(value)
      for (const listener of listeners) listener(value)
    })
    const layout = await settings.ReadOne(SETTINGS_NAMESPACE, SETTINGS_KEY)
    return typeof layout === 'string' ? layout : DEFAULT_BUTTON_LAYOUT
  } catch {
    return DEFAULT_BUTTON_LAYOUT
  }
}

/** @returns {Promise<string>} */
export function getWindowButtonLayout() {
  buttonLayout ??= readButtonLayout()
  return buttonLayout
}

/**
 * @param {(layout: string) => void} listener
 * @returns {() => void} unsubscribe
 */
export function onWindowButtonLayoutChanged(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
