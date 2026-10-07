import { areJsonValuesEqual } from './jsonValues.js'
import { resolveBaseTheme, resolveSystemTheme } from '../../appearanceSettings.js'
import { CUSTOM_THEMES_SYNC_KEY, customThemeIdFromValue, normalizeCustomThemes } from '../../customTheme.js'

export function areSyncSettingValuesEqual(key, left, right) {
  if (key === CUSTOM_THEMES_SYNC_KEY) {
    // Storage order and defaults filled in by different app versions are not edits.
    const normalize = themes => normalizeCustomThemes(themes).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    return areJsonValuesEqual(normalize(left), normalize(right))
  }
  return areJsonValuesEqual(left, right)
}

export function resolveMergedThemeEntry(entry, themes, previousThemes, now) {
  let value = entry.value
  if (entry.key === 'baseTheme') {
    const deletedTheme = previousThemes.find(theme => theme.id === customThemeIdFromValue(value))
    value = resolveBaseTheme(value, resolveBaseTheme(deletedTheme?.basedOn, 'system'), themes)
  } else if (entry.key === 'systemLightTheme' || entry.key === 'systemDarkTheme') {
    value = resolveSystemTheme(value, entry.key === 'systemLightTheme' ? 'light' : 'dark', themes)
  }
  return value === entry.value ? entry : { ...entry, value, updatedAt: Math.max(now, entry.updatedAt) }
}

export function mergeSettingEntry({ key, value, old, remoteEntry, localUpdatedAt, now }) {
  const localChanged = old !== undefined && !areSyncSettingValuesEqual(key, value, old.value)

  if (!old && remoteEntry) return remoteEntry
  if (localChanged && (!remoteEntry || (localUpdatedAt ?? now) >= remoteEntry.updatedAt)) {
    return { key, value, updatedAt: localUpdatedAt ?? now }
  }
  if (remoteEntry && (!old || remoteEntry.updatedAt > old.updatedAt)) return remoteEntry
  return old ?? { key, value, updatedAt: now }
}
