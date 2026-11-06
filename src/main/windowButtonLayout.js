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
 * @returns {Promise<string | null>} null when the portal provided no layout
 */
async function readButtonLayout() {
  let bus = null
  /** @type {string | null} */
  let changedLayout = null
  try {
    // Throws synchronously without a session bus address
    bus = dbus.sessionBus({ timeout: 2_000 })
    bus.connection.on('error', () => {})
    const settings = await bus.getService('org.freedesktop.portal.Desktop')
      .getInterface('/org/freedesktop/portal/desktop', 'org.freedesktop.portal.Settings')
    settings.on('SettingChanged', (namespace, key, value) => {
      if (namespace !== SETTINGS_NAMESPACE || key !== SETTINGS_KEY || typeof value !== 'string') return
      changedLayout = value
      publish(value)
    })
    const layout = await settings.ReadOne(SETTINGS_NAMESPACE, SETTINGS_KEY)
    // The portal can signal a change before it answers the read, so the signal is newer
    return changedLayout ?? (typeof layout === 'string' ? layout : DEFAULT_BUTTON_LAYOUT)
  } catch {
    // A retry connects and subscribes again
    bus?.connection.end()
    if (failedReads < RETRY_DELAYS.length) {
      setTimeout(retryButtonLayout, RETRY_DELAYS[failedReads++]).unref?.()
    }
    // A layout signalled before the read failed is still the newest one
    return changedLayout
  }
}

async function retryButtonLayout() {
  // Requests keep the cached layout while the retry waits for D-Bus
  const cachedLayout = buttonLayout
  const layout = await readButtonLayout()
  // A change signal during the read has already published the newer layout
  if (layout !== null && buttonLayout === cachedLayout) publish(layout)
}

/** @returns {Promise<string>} */
export function getWindowButtonLayout() {
  buttonLayout ??= readButtonLayout().then(layout => layout ?? DEFAULT_BUTTON_LAYOUT)
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
