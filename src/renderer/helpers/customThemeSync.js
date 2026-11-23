import { CUSTOM_THEMES_SYNC_KEY, customThemeValue, isCustomThemeValue } from '../../customTheme.js'
import { resolveSystemThemeSettings } from '../../appearanceSettings.js'

export async function repairSystemThemeSettings({ dispatch, getters, rootGetters }, themes) {
  const settingsGetters = rootGetters ?? getters
  const currentSettings = {
    systemLightTheme: settingsGetters.getSystemLightTheme,
    systemDarkTheme: settingsGetters.getSystemDarkTheme,
  }
  const resolvedSettings = resolveSystemThemeSettings(currentSettings, themes)

  await Promise.all(Object.entries(resolvedSettings).map(([key, value]) => {
    const currentValue = currentSettings[key]
    return value === currentValue ? null : dispatch('repairShownSetting', { settingId: key, value })
  }))
}

/**
 * Saves a custom-theme edit with `save`, which resolves to the saved themes,
 * and its edit time for sync.
 * @param {object} context store action context
 * @param {() => Promise<object[]>} save
 */
export async function commitCustomThemesEdit(context, save) {
  const { commit, dispatch } = context
  const themes = await dispatch('saveSyncSettingEdit', { settingId: CUSTOM_THEMES_SYNC_KEY, save })
  const getters = context.rootGetters ?? context.getters
  const baseTheme = getters.getBaseTheme
  if (isCustomThemeValue(baseTheme) && !themes.some(theme => customThemeValue(theme.id) === baseTheme)) {
    const deletedTheme = getters.getCustomThemes?.find(theme => customThemeValue(theme.id) === baseTheme)
    // Another profile can show while a repair saves, whose settings only
    // need the repairs if they name the deleted theme too.
    const stillShown = () => getters.getBaseTheme === baseTheme
    if (deletedTheme) {
      await dispatch('repairShownSetting', { settingId: 'mainColor', value: deletedTheme.mainColor })
      if (stillShown()) await dispatch('repairShownSetting', { settingId: 'secColor', value: deletedTheme.secondaryColor })
    }
    if (stillShown()) await dispatch('repairShownSetting', { settingId: 'baseTheme', value: deletedTheme?.basedOn ?? 'system' })
  }
  commit('setCustomThemes', themes)
  await repairSystemThemeSettings(context, themes)
  return themes
}
