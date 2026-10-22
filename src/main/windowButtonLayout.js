import dbus from 'dbus-native'

const SETTINGS_NAMESPACE = 'org.gnome.desktop.wm.preferences'
const SETTINGS_KEY = 'button-layout'
const DEFAULT_BUTTON_LAYOUT = ':minimize,maximize,close'
// The portal can still be starting when the app opens at login. Requests keep
// the default meanwhile, so desktops without a portal never wait for D-Bus.
const RETRY_DELAYS = [3_000, 10_000, 30_000]

/** @type {Promise<string> | null} */
let buttonLayout = null
let failedReads = 0
/** @type {Set<(layout: string) => void>} */
const listeners = new Set()

/**
 * @param {string} layout
 */
function publish(layout) {
  buttonLayout = Promise.resolve(layout)
  for (const listener of listeners) listener(layout)
}

/**
 * Reads the title bar button layout in GTK's format, such as
 * `close,minimize,maximize:`. The XDG settings portal provides it on GNOME and
 * translates KWin's button settings on Plasma, inside Flatpak too.
 * @returns {Promise<string>}
 */
async function readButtonLayout() {
  const bus = dbus.sessionBus({ timeout: 2_000 })
  bus.connection.on('error', () => {})
  try {
    const settings = await bus.getService('org.freedesktop.portal.Desktop')
      .getInterface('/org/freedesktop/portal/desktop', 'org.freedesktop.portal.Settings')
    settings.on('SettingChanged', (namespace, key, value) => {
      if (namespace !== SETTINGS_NAMESPACE || key !== SETTINGS_KEY || typeof value !== 'string') return
      publish(value)
    })
    const layout = await settings.ReadOne(SETTINGS_NAMESPACE, SETTINGS_KEY)
    return typeof layout === 'string' ? layout : DEFAULT_BUTTON_LAYOUT
  } catch {
    // A retry connects and subscribes again
    bus.connection.end()
    if (failedReads < RETRY_DELAYS.length) {
      setTimeout(retryButtonLayout, RETRY_DELAYS[failedReads++]).unref?.()
    }
    return DEFAULT_BUTTON_LAYOUT
  }
}

async function retryButtonLayout() {
  buttonLayout = readButtonLayout()
  const layout = await buttonLayout
  // Windows show the default until then
  if (layout !== DEFAULT_BUTTON_LAYOUT) publish(layout)
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
