import { BASE_THEME_BACKGROUND_COLORS } from '../constants.js'
import { isCustomThemeValue } from '../customTheme.js'
import { resolveSystemTheme } from '../appearanceSettings.js'

/**
 * @typedef {{
 *   settings: Pick<typeof import('../datastores/handlers/base').settings, '_findOne'>,
 *   nativeTheme: Pick<import('electron').NativeTheme, 'shouldUseDarkColors'>,
 *   loadCustomThemes: () => Promise<object[]>,
 *   getSelectedCustomTheme: (value: string) => Promise<object | null>
 * }} WindowBackgroundDependencies
 */

/** @param {WindowBackgroundDependencies} dependencies */
export async function resolveWindowBackground({ settings, nativeTheme, loadCustomThemes, getSelectedCustomTheme }) {
  return await settings._findOne('baseTheme').then(async (setting) => {
    let theme = setting?.value ?? 'system'
    if (theme === 'system') {
      const classification = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
      const selected = await settings._findOne(
        classification === 'dark' ? 'systemDarkTheme' : 'systemLightTheme'
      )
      const customThemes = isCustomThemeValue(selected?.value) ? await loadCustomThemes() : []
      theme = resolveSystemTheme(selected?.value, classification, customThemes)
    }

    // Determine window color to be shown (shown most prominently during initial app load)
    // Uses the --bg-color for each corresponding theme
    if (isCustomThemeValue(theme)) {
      return (await getSelectedCustomTheme(theme))?.colors.background ??
          (nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f1f1f1')
    }
    return BASE_THEME_BACKGROUND_COLORS[theme] ??
        (nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f1f1f1')
  }).catch((error) => {
    console.error(error)
    // Default to nativeTheme settings if nothing is found.
    return nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f1f1f1'
  })
}

/**
 * @param {{
 *   settings: Pick<typeof import('../datastores/handlers/base').settings, '_findOne'>,
 *   screen: Pick<import('electron').Screen, 'getAllDisplays'>,
 *   sessionData: { bounds?: object } | null
 * }} dependencies
 */
export async function resolveWindowBounds({ settings, screen, sessionData }) {
  let savedBounds, savedMaximized

  /**
   * Check that the saved bounds still lie on one of the currently connected
   * displays. If a monitor was disconnected since the bounds were saved, we
   * want to fall back to a default position instead of placing the window
   * off-screen.
   * @param {{x: number, y: number, width: number, height: number}} bounds
   */
  const boundsOnVisibleDisplay = (bounds) => {
    return screen.getAllDisplays().some(display => {
      const { x, y, width, height } = display.bounds
      return !(bounds.x > x + width || bounds.x + bounds.width < x || bounds.y > y + height || bounds.y + bounds.height < y)
    })
  }

  // Prefer this window's own persisted bounds (from its last session) if
  // available. Otherwise fall back to the legacy app-wide `bounds` setting
  // so brand-new windows still open where the user last had one.
  if (sessionData?.bounds && typeof sessionData.bounds === 'object') {
    const { maximized, fullScreen: _fullScreen, ...bounds } = sessionData.bounds
    if (boundsOnVisibleDisplay(bounds)) {
      savedBounds = bounds
    }
    savedMaximized = maximized
  } else {
    const boundsDoc = await settings._findOne('bounds')
    if (typeof boundsDoc?.value === 'object') {
      const { maximized, ...bounds } = boundsDoc.value
      if (boundsOnVisibleDisplay(bounds)) {
        savedBounds = bounds
      }
      savedMaximized = maximized
    }
  }

  return { savedBounds, savedMaximized }
}
