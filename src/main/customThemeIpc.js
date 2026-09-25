import { IpcChannels } from '../constants.js'
import { customThemeIdFromValue, customThemeValue, isCustomThemeValue } from '../customTheme.js'
import { resolveSystemTheme, resolveSystemThemeSettings } from '../appearanceSettings.js'

/**
 * @typedef {{ id: string, basedOn: string, isDark: boolean, mainColor: string, secondaryColor: string }} CustomThemeRecord
 * @typedef {{ senderFrame: { url: string } }} ThemeIpcEvent
 */

/**
 * Owns custom theme IPC, persistence notifications, and the settings that may
 * refer to deleted themes. All platform and datastore dependencies are explicit.
 */
export function registerCustomThemeIpc({
  ipcMain,
  isTrustedUrl,
  store,
  settings,
  updateSetting,
  nativeTheme,
  getWindows,
  setBaseThemeSource
}) {
  async function publish(themes) {
    const selectedTheme = (await settings._findOne('baseTheme'))?.value
    const selectedCustomTheme = isCustomThemeValue(selectedTheme)
      ? themes.find(({ id }) => id === customThemeIdFromValue(selectedTheme)) ?? themes[0]
      : null
    if (selectedCustomTheme) {
      nativeTheme.themeSource = selectedCustomTheme.isDark ? 'dark' : 'light'
    }
    getWindows().forEach((window) => {
      if (isTrustedUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.CUSTOM_THEME_UPDATED, themes)
      }
    })
  }

  async function repairSystemThemeSettings(themes) {
    const [systemLightTheme, systemDarkTheme] = await Promise.all([
      settings._findOne('systemLightTheme'),
      settings._findOne('systemDarkTheme')
    ])
    const currentSettings = {
      systemLightTheme: systemLightTheme?.value ?? 'light',
      systemDarkTheme: systemDarkTheme?.value ?? 'dark',
    }
    const resolvedSettings = resolveSystemThemeSettings(currentSettings, themes)

    await Promise.all(Object.entries(resolvedSettings).map(([key, value]) => (
      value === currentSettings[key] ? null : updateSetting(key, value, currentSettings[key])
    )))
  }

  ipcMain.handle(IpcChannels.CUSTOM_THEME_LOAD, async (/** @type {ThemeIpcEvent} */ event) => {
    if (!isTrustedUrl(event.senderFrame.url)) return
    return await store.load()
  })

  ipcMain.handle(IpcChannels.CUSTOM_THEME_SAVE, async (/** @type {ThemeIpcEvent} */ event, /** @type {CustomThemeRecord} */ theme) => {
    if (!isTrustedUrl(event.senderFrame.url)) return

    const themes = await store.save(theme)
    await repairSystemThemeSettings(themes)
    await publish(themes)
    return themes
  })

  ipcMain.handle(IpcChannels.CUSTOM_THEME_REPLACE, async (/** @type {ThemeIpcEvent} */ event, /** @type {CustomThemeRecord[]} */ themes) => {
    if (!isTrustedUrl(event.senderFrame.url)) return

    const normalizedThemes = await store.replace(themes)
    await repairSystemThemeSettings(normalizedThemes)
    await publish(normalizedThemes)
    return normalizedThemes
  })

  ipcMain.handle(IpcChannels.CUSTOM_THEME_DELETE, async (/** @type {ThemeIpcEvent} */ event, /** @type {string} */ themeId) => {
    if (!isTrustedUrl(event.senderFrame.url)) return

    const deletedTheme = (await store.load()).find(({ id }) => id === themeId)
    const themes = await store.remove(themeId)
    if (deletedTheme) {
      const deletedThemeValue = customThemeValue(themeId)
      const [baseTheme, systemLightTheme, systemDarkTheme] = await Promise.all([
        settings._findOne('baseTheme'),
        settings._findOne('systemLightTheme'),
        settings._findOne('systemDarkTheme')
      ])
      if (systemLightTheme?.value === deletedThemeValue) {
        await updateSetting(
          'systemLightTheme',
          resolveSystemTheme(deletedTheme.basedOn, 'light'),
          deletedThemeValue
        )
      }
      if (systemDarkTheme?.value === deletedThemeValue) {
        await updateSetting(
          'systemDarkTheme',
          resolveSystemTheme(deletedTheme.basedOn, 'dark'),
          deletedThemeValue
        )
      }
      if (baseTheme?.value === deletedThemeValue) {
        await updateSetting('mainColor', deletedTheme.mainColor)
        await updateSetting('secColor', deletedTheme.secondaryColor)
        await updateSetting('baseTheme', deletedTheme.basedOn)
        setBaseThemeSource(deletedTheme.basedOn)
      }
    }
    await repairSystemThemeSettings(themes)
    await publish(themes)
    return themes
  })
}
