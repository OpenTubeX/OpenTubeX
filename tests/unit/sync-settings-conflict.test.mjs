import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_CUSTOM_THEME, normalizeCustomThemes } from '../../src/customTheme.js'

import {
  commitCustomThemesEdit,
  repairSystemThemeSettings,
} from '../../src/renderer/helpers/customThemeSync.js'
import { mergeSettingEntry, migrateLegacySyncedSettings, resolveMergedThemeEntry } from '../../src/renderer/helpers/sync-settings-conflict.js'

test('theme sync does not echo colors filled in while loading a received theme', () => {
  const theme = structuredClone({ ...DEFAULT_CUSTOM_THEME, id: 'discussion-1196', name: 'D3SOX' })
  delete theme.colors.watchedThumbnailOverlay
  delete theme.colors.thumbnailBadgeBackground
  delete theme.blurs.thumbnailBadgeBackground
  const received = { key: 'customThemes', value: [theme], updatedAt: 10 }
  const entry = mergeSettingEntry({
    key: 'customThemes', value: normalizeCustomThemes(received.value),
    old: received, remoteEntry: received, now: 100,
  })
  assert.deepEqual(entry, received, 'Loading default colors must not create another sync update')
})

test('theme sync does not echo a desktop theme list sorted by name', () => {
  const themes = normalizeCustomThemes([
    { ...DEFAULT_CUSTOM_THEME, id: 'youtube', name: 'YouTube Web Dark' },
    { ...DEFAULT_CUSTOM_THEME, id: 'd3sox', name: 'D3SOX' },
  ])
  const received = { key: 'customThemes', value: themes, updatedAt: 10 }
  const entry = mergeSettingEntry({
    key: 'customThemes', value: [...themes].reverse(),
    old: received, remoteEntry: received, now: 100,
  })
  assert.deepEqual(entry, received, 'Storage order must not create another sync update')
})

test('equivalent theme snapshots with the same edit time keep the server representation', () => {
  const themes = normalizeCustomThemes([{ ...DEFAULT_CUSTOM_THEME, id: 'theme-1' }])
  const withoutDefaults = structuredClone(themes)
  delete withoutDefaults[0].colors.watchedThumbnailOverlay
  delete withoutDefaults[0].colors.thumbnailBadgeBackground
  delete withoutDefaults[0].blurs.thumbnailBadgeBackground
  for (const [saved, remote] of [[withoutDefaults, themes], [themes, withoutDefaults]]) {
    const remoteEntry = { key: 'customThemes', value: remote, updatedAt: 10 }
    const entry = mergeSettingEntry({
      key: 'customThemes', value: themes,
      old: { key: 'customThemes', value: saved, updatedAt: 10 },
      remoteEntry, localUpdatedAt: 5, now: 100,
    })
    assert.deepEqual(entry, remoteEntry, 'An unchanged snapshot must not overwrite the server on a timestamp tie')
  }
})

test('unchanged settings accept the server on an edit-time tie and retain a newer snapshot', () => {
  const old = { key: 'baseTheme', value: 'dark', updatedAt: 10 }
  const remoteEntry = { key: 'baseTheme', value: 'light', updatedAt: 10 }
  assert.deepEqual(mergeSettingEntry({ key: 'baseTheme', value: 'dark', old, remoteEntry, now: 100 }), remoteEntry)
  assert.deepEqual(mergeSettingEntry({
    key: 'baseTheme', value: 'dark', old: { ...old, updatedAt: 20 }, remoteEntry, now: 100,
  }), { ...old, updatedAt: 20 })
})

for (const [change, edit] of [
  ['rename', themes => { themes[0].name = 'Renamed' }],
  ['color', themes => { themes[0].colors.primaryText = '#123456' }],
  ['custom overlay', themes => { themes[0].colors.watchedThumbnailOverlay = '#abcdef80' }],
  ['custom badge background', themes => { themes[0].colors.thumbnailBadgeBackground = '#abcdef80' }],
  ['blur', themes => { themes[0].blurs.cardBackground = 20 }],
  ['addition', themes => { themes.push({ ...structuredClone(themes[0]), id: 'added' }) }],
  ['deletion', themes => { themes.pop() }],
]) {
  test(`theme sync still uploads a real ${change}`, () => {
    const original = normalizeCustomThemes([{ ...DEFAULT_CUSTOM_THEME, id: 'theme-1' }])
    const value = structuredClone(original)
    edit(value)
    const received = { key: 'customThemes', value: original, updatedAt: 10 }
    const entry = mergeSettingEntry({
      key: 'customThemes', value, old: received, remoteEntry: received, localUpdatedAt: 20, now: 100,
    })
    assert.deepEqual(entry, { key: 'customThemes', value, updatedAt: 20 })
    assert.deepEqual(received.value, original)
  })
}

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
  const localThemes = [{ ...DEFAULT_CUSTOM_THEME, id: 'theme-1', name: 'Local' }]
  const remoteThemes = [{ ...DEFAULT_CUSTOM_THEME, id: 'theme-1', name: 'Remote' }]
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

test('deleting the selected custom theme restores its base and accent colors before removing it', async () => {
  const calls = []
  const theme = { id: 'deleted', basedOn: 'dark', mainColor: 'Purple', secondaryColor: 'Blue' }
  await commitCustomThemesEdit({
    dispatch: async (action, payload) => calls.push([action, payload]),
    commit: (mutation, payload) => calls.push([mutation, payload]),
    rootGetters: {
      getBaseTheme: 'custom:deleted', getCustomThemes: [theme],
      getSystemLightTheme: 'light', getSystemDarkTheme: 'dark',
    },
  }, [])
  assert.deepEqual(calls, [
    ['recordSyncSettingEdit', 'customThemes'],
    ['updateMainColor', 'Purple'],
    ['updateSecColor', 'Blue'],
    ['updateBaseTheme', 'dark'],
    ['setCustomThemes', []],
  ])
})

test('devices read Auto Load Comments from the Auto Load Next Page entry of older versions', () => {
  const key = 'autoLoadComments'
  const legacy = { key: 'generalAutoLoadMorePaginatedItemsEnabled', value: false, updatedAt: 10 }
  const remote = migrateLegacySyncedSettings({ generalAutoLoadMorePaginatedItemsEnabled: legacy })

  // A new device adopts the account's choice instead of uploading its default.
  assert.deepEqual(mergeSettingEntry({ key, value: true, remoteEntry: remote[key], now: 100 }),
    { key, value: false, updatedAt: 10 })
  assert.equal(remote.generalAutoLoadMorePaginatedItemsEnabled, legacy)

  assert.equal(migrateLegacySyncedSettings({
    generalAutoLoadMorePaginatedItemsEnabled: { ...legacy, value: true },
  })[key].value, true)
  const current = { key, value: true, updatedAt: 5 }
  assert.equal(migrateLegacySyncedSettings({ generalAutoLoadMorePaginatedItemsEnabled: legacy, [key]: current })[key], current)
})

test('devices read the Video descriptions select from the Hide Video Description entry of older versions', () => {
  const key = 'videoDescriptionMode'
  const legacy = { key: 'hideVideoDescription', value: true, updatedAt: 10 }
  const remote = migrateLegacySyncedSettings({ hideVideoDescription: legacy })

  // A new device adopts the account's choice instead of uploading its default.
  assert.deepEqual(mergeSettingEntry({ key, value: 'collapsed', remoteEntry: remote[key], now: 100 }),
    { key, value: 'hide', updatedAt: 10 })
  // An upgraded device keeps the choice it migrated locally.
  assert.equal(mergeSettingEntry({ key, value: 'hide', remoteEntry: remote[key], now: 100 }).value, 'hide')
  // A choice changed before the first sync after upgrading wins over the older server entry.
  assert.equal(mergeSettingEntry({
    key, value: 'expanded', old: remote[key], remoteEntry: remote[key], localUpdatedAt: 20, now: 100,
  }).value, 'expanded')

  assert.equal(migrateLegacySyncedSettings({ hideVideoDescription: { ...legacy, value: false } })[key].value, 'collapsed')
  const current = { key, value: 'expanded', updatedAt: 5 }
  assert.equal(migrateLegacySyncedSettings({ hideVideoDescription: legacy, [key]: current })[key], current)

  const pins = { key: 'quickSettings', value: ['hideComments', 'hideVideoDescription'], updatedAt: 10 }
  assert.deepEqual(migrateLegacySyncedSettings({ quickSettings: pins }).quickSettings,
    { ...pins, value: ['hideComments', key] })
})
