import { CUSTOM_THEMES_SYNC_KEY } from '../../customTheme.js'

export async function applyChangedSyncSettings({
  local,
  merged,
  valuesEqual,
  applyCustomThemes,
  applySetting,
}) {
  const customThemes = merged[CUSTOM_THEMES_SYNC_KEY]
  if (customThemes && !valuesEqual(local[CUSTOM_THEMES_SYNC_KEY], customThemes.value)) {
    await applyCustomThemes(customThemes.value)
  }

  for (const [key, value] of Object.entries(local)) {
    if (key === CUSTOM_THEMES_SYNC_KEY) continue

    const entry = merged[key]
    if (valuesEqual(value, entry.value)) continue
    await applySetting(key, entry.value)
  }
}
