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
    const action = `update${key.charAt(0).toUpperCase()}${key.slice(1)}`
    return value === currentValue ? null : dispatch(action, value)
  }))
}

export async function commitCustomThemesEdit(context, themes) {
  const { commit, dispatch } = context
  await dispatch('recordSyncSettingEdit', CUSTOM_THEMES_SYNC_KEY)
  const getters = context.rootGetters ?? context.getters
  const baseTheme = getters.getBaseTheme
  if (isCustomThemeValue(baseTheme) && !themes.some(theme => customThemeValue(theme.id) === baseTheme)) {
    const deletedTheme = getters.getCustomThemes?.find(theme => customThemeValue(theme.id) === baseTheme)
    if (deletedTheme) {
      await dispatch('updateMainColor', deletedTheme.mainColor)
      await dispatch('updateSecColor', deletedTheme.secondaryColor)
    }
    await dispatch('updateBaseTheme', deletedTheme?.basedOn ?? 'system')
  }
  commit('setCustomThemes', themes)
  await repairSystemThemeSettings(context, themes)
}
