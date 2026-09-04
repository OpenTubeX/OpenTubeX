import assert from 'node:assert/strict'
import test from 'node:test'

import { applyChangedSyncSettings } from '../../src/renderer/helpers/sync-settings-apply.js'

async function restoreCustomThemeSelections (remoteSelections) {
  const customThemes = [{ id: 'synced-theme', name: 'Synced theme' }]
  const selections = {
    baseTheme: 'system',
    systemLightTheme: 'light',
    systemDarkTheme: 'dark',
  }
  let availableThemes = []
  const local = { ...selections, customThemes: [] }
  const merged = {
    ...Object.fromEntries(Object.entries(remoteSelections).map(([key, value]) => (
      [key, { value }]
    ))),
    customThemes: { value: customThemes },
  }

  await applyChangedSyncSettings({
    local,
    merged,
    valuesEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    applyCustomThemes: themes => { availableThemes = themes },
    applySetting: (key, value) => {
      selections[key] = availableThemes.some(theme => value === `custom:${theme.id}`)
        ? value
        : selections[key]
    },
  })

  return selections
}

test('restores custom dark and light themes after syncing them to a new device', async () => {
  const customThemeValue = 'custom:synced-theme'
  const selections = await restoreCustomThemeSelections({
    baseTheme: 'system',
    systemLightTheme: customThemeValue,
    systemDarkTheme: customThemeValue,
  })

  assert.deepEqual(selections, {
    baseTheme: 'system',
    systemLightTheme: customThemeValue,
    systemDarkTheme: customThemeValue,
  })
})

test('restores a custom sole theme after syncing it to a new device', async () => {
  const customThemeValue = 'custom:synced-theme'
  const selections = await restoreCustomThemeSelections({
    baseTheme: customThemeValue,
    systemLightTheme: 'light',
    systemDarkTheme: 'dark',
  })

  assert.deepEqual(selections, {
    baseTheme: customThemeValue,
    systemLightTheme: 'light',
    systemDarkTheme: 'dark',
  })
})
