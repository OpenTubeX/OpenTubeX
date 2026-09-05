import assert from 'node:assert/strict'
import test from 'node:test'

import {
  commitCustomThemesEdit,
  repairSystemThemeSettings,
} from '../../src/renderer/helpers/customThemeSync.js'
import { mergeSettingEntry, resolveMergedThemeEntry } from '../../src/renderer/helpers/sync-settings-conflict.js'

test('normalizes newer theme selections against a winning collection deletion', () => {
  const previousThemes = [{ id: 'removed', isDark: true, basedOn: 'solarizedDark' }]
  for (const [key, fallback] of Object.entries({
    baseTheme: 'solarizedDark', systemLightTheme: 'light', systemDarkTheme: 'dark',
  })) {
    const entry = mergeSettingEntry({
      key, value: 'custom:removed', old: { key, value: fallback, updatedAt: 10 },
      remoteEntry: { key, value: fallback, updatedAt: 30 }, localUpdatedAt: 40, now: 100,
    })
    assert.equal(entry.value, 'custom:removed')
    assert.deepEqual(resolveMergedThemeEntry(entry, [], previousThemes, 100), {
      key, value: fallback, updatedAt: 100,
    })
  }
})

test('retains valid merged selections and repairs classification changes', () => {
  const themes = [{ id: 'paper', isDark: false }]
  const entry = { key: 'systemLightTheme', value: 'custom:paper', updatedAt: 40 }
  assert.equal(resolveMergedThemeEntry(entry, themes, [], 100), entry)
  assert.deepEqual(resolveMergedThemeEntry({ ...entry, key: 'systemDarkTheme' }, themes, [], 100), {
    key: 'systemDarkTheme', value: 'dark', updatedAt: 100,
  })
})

test('uses the actual local edit time instead of the later sync time', () => {
  const entry = mergeSettingEntry({
    key: 'baseTheme',
    value: 'dark',
    old: { key: 'baseTheme', value: 'system', updatedAt: 10 },
    remoteEntry: { key: 'baseTheme', value: 'light', updatedAt: 30 },
    localUpdatedAt: 20,
    now: 100,
  })

  assert.equal(entry.value, 'light')
  assert.equal(entry.updatedAt, 30)
})

test('keeps a genuinely newer local setting edit', () => {
  const entry = mergeSettingEntry({
    key: 'baseTheme',
    value: 'dark',
    old: { key: 'baseTheme', value: 'system', updatedAt: 10 },
    remoteEntry: { key: 'baseTheme', value: 'light', updatedAt: 30 },
    localUpdatedAt: 40,
    now: 100,
  })

  assert.equal(entry.value, 'dark')
  assert.equal(entry.updatedAt, 40)
})

test('does not treat reordered object keys as a local setting edit', () => {
  const remoteEntry = {
    key: 'homeSections',
    value: { subscriptions: true, trending: false },
    updatedAt: 30,
  }
  const entry = mergeSettingEntry({
    key: 'homeSections',
    value: { trending: true, subscriptions: true },
    old: {
      key: 'homeSections',
      value: { subscriptions: true, trending: true },
      updatedAt: 10,
    },
    remoteEntry,
    localUpdatedAt: 40,
    now: 100,
  })

  assert.deepEqual(entry, remoteEntry)
})

test('records a custom-theme edit before publishing the new theme list', async () => {
  const calls = []
  const themes = [{ id: 'theme-1', name: 'Test theme' }]

  await commitCustomThemesEdit({
    dispatch: async (action, payload) => calls.push(['dispatch', action, payload]),
    commit: (mutation, payload) => calls.push(['commit', mutation, payload]),
    rootGetters: {
      getSystemLightTheme: 'light',
      getSystemDarkTheme: 'dark',
    },
  }, themes)

  assert.deepEqual(calls, [
    ['dispatch', 'recordSyncSettingEdit', 'customThemes'],
    ['commit', 'setCustomThemes', themes],
  ])
})

test('resets a system theme slot when a custom theme changes classification', async () => {
  const calls = []
  const themes = [{ id: 'theme-1', name: 'Test theme', isDark: true }]

  await commitCustomThemesEdit({
    dispatch: async (action, payload) => calls.push(['dispatch', action, payload]),
    commit: (mutation, payload) => calls.push(['commit', mutation, payload]),
    rootGetters: {
      getSystemLightTheme: 'custom:theme-1',
      getSystemDarkTheme: 'dark',
    },
  }, themes)

  assert.deepEqual(calls, [
    ['dispatch', 'recordSyncSettingEdit', 'customThemes'],
    ['commit', 'setCustomThemes', themes],
    ['dispatch', 'updateSystemLightTheme', 'light'],
  ])
})

test('repairs system theme slots from a store after a cross-window update', async () => {
  const calls = []
  const themes = [{ id: 'theme-1', name: 'Test theme', isDark: true }]

  await repairSystemThemeSettings({
    dispatch: async (action, payload) => calls.push([action, payload]),
    getters: {
      getSystemLightTheme: 'custom:theme-1',
      getSystemDarkTheme: 'dark',
    },
  }, themes)

  assert.deepEqual(calls, [['updateSystemLightTheme', 'light']])
})

test('uses the custom-theme edit timestamp when resolving a conflict', () => {
  const localThemes = [{ id: 'theme-1', name: 'Local' }]
  const remoteThemes = [{ id: 'theme-1', name: 'Remote' }]
  const entry = mergeSettingEntry({
    key: 'customThemes',
    value: localThemes,
    old: { key: 'customThemes', value: [], updatedAt: 10 },
    remoteEntry: { key: 'customThemes', value: remoteThemes, updatedAt: 30 },
    localUpdatedAt: 20,
    now: 100,
  })

  assert.deepEqual(entry.value, remoteThemes)
  assert.equal(entry.updatedAt, 30)
})
