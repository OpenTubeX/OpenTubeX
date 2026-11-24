import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_CUSTOM_THEME, normalizeCustomThemes } from '../../src/customTheme.js'

import { commitCustomThemesEdit } from '../../src/renderer/helpers/customThemeSync.js'
import {
  mergeSettingEntry,
  mergeSettingListEntry,
  mergeProfileSettingsEntry,
  migrateLegacySyncedSettings,
  resolveMergedThemeEntry,
} from '../../src/renderer/helpers/sync-settings-conflict.js'

test('theme sync does not echo colors filled in while loading a received theme', () => {
  const theme = structuredClone({ ...DEFAULT_CUSTOM_THEME, id: 'discussion-1196', name: 'D3SOX' })
  delete theme.colors.watchedThumbnailOverlay
  delete theme.colors.thumbnailBadgeBackground
  delete theme.blurs.thumbnailBadgeBackground
  const received = { key: 'customThemes', value: [theme], updatedAt: 10 }
  const entry = mergeSettingEntry({
    key: 'customThemes',
    value: normalizeCustomThemes(received.value),
    old: received,
    remoteEntry: received,
    now: 100,
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
    key: 'customThemes',
    value: [...themes].reverse(),
    old: received,
    remoteEntry: received,
    now: 100,
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
      key: 'customThemes',
      value: themes,
      old: { key: 'customThemes', value: saved, updatedAt: 10 },
      remoteEntry,
      localUpdatedAt: 5,
      now: 100,
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
    baseTheme: 'solarizedDark', systemLightTheme: 'openTubeXLight', systemDarkTheme: 'openTubeXDark',
  })) {
    const entry = mergeSettingEntry({
      key,
      value: 'custom:removed',
      old: { key, value: fallback, updatedAt: 10 },
      remoteEntry: { key, value: fallback, updatedAt: 30 },
      localUpdatedAt: 40,
      now: 100,
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
    key: 'systemDarkTheme', value: 'openTubeXDark', updatedAt: 100,
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

test('saves a custom-theme edit with its edit time before publishing the new theme list', async () => {
  const calls = []
  const themes = [{ id: 'theme-1', name: 'Test theme' }]

  await commitCustomThemesEdit({
    dispatch: async (action, payload) => {
      if (action !== 'saveSyncSettingEdit') return calls.push(['dispatch', action, payload])
      calls.push(['dispatch', action, payload.settingId])
      return payload.save()
    },
    commit: (mutation, payload) => calls.push(['commit', mutation, payload]),
    rootGetters: {
      getSystemLightTheme: 'light',
      getSystemDarkTheme: 'dark',
    },
  }, async () => {
    calls.push(['save'])
    return themes
  })

  assert.deepEqual(calls, [
    ['dispatch', 'saveSyncSettingEdit', 'customThemes'],
    ['save'],
    ['commit', 'setCustomThemes', themes],
  ])
})

test('resets a system theme slot when a custom theme changes classification', async () => {
  const calls = []
  const themes = [{ id: 'theme-1', name: 'Test theme', isDark: true }]

  await commitCustomThemesEdit({
    dispatch: async (action, payload) => {
      if (action !== 'saveSyncSettingEdit') return calls.push(['dispatch', action, payload])
      calls.push(['dispatch', action, payload.settingId])
      return payload.save()
    },
    commit: (mutation, payload) => calls.push(['commit', mutation, payload]),
    rootGetters: {
      getSystemLightTheme: 'custom:theme-1',
      getSystemDarkTheme: 'dark',
    },
  }, async () => themes)

  assert.deepEqual(calls, [
    ['dispatch', 'saveSyncSettingEdit', 'customThemes'],
    ['commit', 'setCustomThemes', themes],
    ['dispatch', 'repairShownSetting', { settingId: 'systemLightTheme', value: 'openTubeXLight' }],
  ])
})

test('stops repairing a deleted theme once another profile without it shows', async () => {
  const deleted = { id: 'theme-1', mainColor: 'Green', secondaryColor: 'Pink', basedOn: 'dark' }
  const getters = { getBaseTheme: 'custom:theme-1', getCustomThemes: [deleted], getSystemLightTheme: 'light', getSystemDarkTheme: 'dark' }
  const repairs = []
  await commitCustomThemesEdit({
    dispatch: async (action, payload) => {
      if (action === 'saveSyncSettingEdit') return payload.save()
      repairs.push(payload.settingId)
      // A profile with its own valid theme shows while the first repair saves.
      getters.getBaseTheme = 'dark'
    },
    commit: () => {},
    rootGetters: getters,
  }, async () => [])
  assert.deepEqual(repairs, ['mainColor'])
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

test('devices read the Hold to Speed Up multiplier from the switch of older versions', () => {
  const legacy = { key: 'holdToDoublePlaybackSpeed', value: false, updatedAt: 10 }
  assert.deepEqual(migrateLegacySyncedSettings({ holdToDoublePlaybackSpeed: legacy }).holdPlaybackRateMultiplier,
    { key: 'holdPlaybackRateMultiplier', value: 0, updatedAt: 10 })
  const current = { key: 'holdPlaybackRateMultiplier', value: 3, updatedAt: 5 }
  assert.equal(migrateLegacySyncedSettings({ holdToDoublePlaybackSpeed: legacy, holdPlaybackRateMultiplier: current }).holdPlaybackRateMultiplier, current)
})

test('devices read the Data Saver Thumbnails mode from the switch of older versions', () => {
  const legacy = { key: 'thumbnailDataSaver', value: true, updatedAt: 10 }
  assert.deepEqual(migrateLegacySyncedSettings({ thumbnailDataSaver: legacy }).thumbnailDataSaverMode,
    { key: 'thumbnailDataSaverMode', value: 'always', updatedAt: 10 })
  const current = { key: 'thumbnailDataSaverMode', value: 'metered', updatedAt: 5 }
  assert.equal(migrateLegacySyncedSettings({ thumbnailDataSaver: legacy, thumbnailDataSaverMode: current }).thumbnailDataSaverMode, current)
})

test('devices read the Keep the Player Visible switch from the scroll player settings of older versions', () => {
  const legacy = { key: 'scrollPlayerMode', value: 'off', updatedAt: 10 }
  assert.deepEqual(migrateLegacySyncedSettings({ scrollPlayerMode: legacy }).keepPlayerVisibleOnScroll,
    { key: 'keepPlayerVisibleOnScroll', value: false, updatedAt: 10 })
  const current = { key: 'keepPlayerVisibleOnScroll', value: true, updatedAt: 5 }
  assert.equal(migrateLegacySyncedSettings({ scrollPlayerMode: legacy, keepPlayerVisibleOnScroll: current }).keepPlayerVisibleOnScroll, current)
})

test('devices read the Title Lines select from the Limit Titles to Two Lines switch of older versions', () => {
  const legacy = { key: 'limitTitlesToTwoLines', value: false, updatedAt: 10 }
  assert.deepEqual(migrateLegacySyncedSettings({ limitTitlesToTwoLines: legacy }).titleLineLimit,
    { key: 'titleLineLimit', value: 0, updatedAt: 10 })
  assert.equal(migrateLegacySyncedSettings({ limitTitlesToTwoLines: { ...legacy, value: true } }).titleLineLimit.value, 2)
  const current = { key: 'titleLineLimit', value: 3, updatedAt: 5 }
  assert.equal(migrateLegacySyncedSettings({ limitTitlesToTwoLines: legacy, titleLineLimit: current }).titleLineLimit, current)
})

test('settings of one profile edited on two devices before they sync are all kept', () => {
  const key = 'profileSettings-636172'
  const old = { key, value: { hideComments: false, hideLiveChat: false, iconPack: 'remix' }, updatedAt: 10 }
  // The other device hid live chat and went back to the shared icon pack;
  // this device hid comments and changed live chat later.
  const remoteEntry = { key, value: { hideComments: false, hideLiveChat: true }, updatedAt: 30 }
  const value = { hideComments: true, hideLiveChat: 'later', iconPack: 'remix' }
  const entry = mergeProfileSettingsEntry({ key, value, old, remoteEntry, localUpdatedAt: 40, now: 50 })
  assert.deepEqual(entry.value, { hideComments: true, hideLiveChat: 'later' })
  assert.equal(entry.updatedAt, 40)

  // An earlier edit of a setting the other device changed too loses it.
  const earlier = mergeProfileSettingsEntry({ key, value, old, remoteEntry, localUpdatedAt: 20, now: 50 })
  assert.deepEqual(earlier.value, { hideComments: true, hideLiveChat: true })
  assert.ok(earlier.updatedAt >= remoteEntry.updatedAt, 'The merged settings must replace the server ones on other devices')

  const unchanged = mergeProfileSettingsEntry({ key, value: old.value, old, remoteEntry, now: 50 })
  assert.equal(unchanged, remoteEntry, 'Unedited settings must take the server ones')
})

test('the later edit of a profile setting wins even when one device went back to the synced value', () => {
  const key = 'profileSettings-636172'
  const old = { key, value: { preferredCaptionLocale: 'en' }, updatedAt: 10, settingsUpdatedAt: { preferredCaptionLocale: 10 } }
  const remote = (value, editedAt) => ({
    key, value: { preferredCaptionLocale: value }, updatedAt: editedAt, settingsUpdatedAt: { preferredCaptionLocale: editedAt },
  })
  const local = (value, editedAt) => ({
    key, value: { preferredCaptionLocale: value }, old, localUpdatedAt: editedAt, localSettingUpdatedAt: () => editedAt, now: 50,
  })

  // This device went from en to fr and back to en at 40; the other device chose de at 30.
  const backHere = mergeProfileSettingsEntry({ ...local('en', 40), remoteEntry: remote('de', 30) })
  assert.deepEqual(backHere.value, { preferredCaptionLocale: 'en' })
  assert.deepEqual(backHere.settingsUpdatedAt, { preferredCaptionLocale: 40 })

  // The other device went back to en at 30, after this device chose fr at 20.
  const backThere = remote('en', 30)
  assert.equal(mergeProfileSettingsEntry({ ...local('fr', 20), remoteEntry: backThere }), backThere)

  // Both chose fr; the later edit time is kept so a third device's earlier edit loses.
  const both = mergeProfileSettingsEntry({ ...local('fr', 40), remoteEntry: remote('fr', 20) })
  assert.deepEqual(both.value, { preferredCaptionLocale: 'fr' })
  assert.deepEqual(both.settingsUpdatedAt, { preferredCaptionLocale: 40 })
})

test('the later edit of a profile setting wins, whenever either device edited its other settings', () => {
  const key = 'profileSettings-636172'
  const old = { key, value: { hideComments: false, preferredCaptionLocale: 'en' }, updatedAt: 10 }
  // This device chose French captions at 20 and hid comments at 40; the other
  // device chose German captions at 30.
  const value = { hideComments: true, preferredCaptionLocale: 'fr' }
  const localTimes = { hideComments: 40, preferredCaptionLocale: 20 }
  const local = { key, value, old, localUpdatedAt: 40, localSettingUpdatedAt: id => localTimes[id], now: 50 }
  const german = {
    key,
    value: { hideComments: false, preferredCaptionLocale: 'de' },
    updatedAt: 30,
    settingsUpdatedAt: { hideComments: 10, preferredCaptionLocale: 30 },
  }
  const entry = mergeProfileSettingsEntry({ ...local, remoteEntry: german })
  assert.deepEqual(entry.value, { hideComments: true, preferredCaptionLocale: 'de' })
  assert.deepEqual(entry.settingsUpdatedAt, { hideComments: 40, preferredCaptionLocale: 30 })
  assert.equal(entry.updatedAt, 40)

  // The same when this device synced first: the other device's later caption
  // language wins over the server entry's later edit time.
  const french = { key, value, updatedAt: 40, settingsUpdatedAt: localTimes }
  const other = mergeProfileSettingsEntry({
    key,
    value: german.value,
    old,
    remoteEntry: french,
    localUpdatedAt: 30,
    localSettingUpdatedAt: id => ({ preferredCaptionLocale: 30 })[id],
    now: 50,
  })
  assert.deepEqual(other.value, { hideComments: true, preferredCaptionLocale: 'de' })
  assert.deepEqual(other.settingsUpdatedAt, { hideComments: 40, preferredCaptionLocale: 30 })
})

test('a profile setting that went back to the shared value keeps its edit time', () => {
  const key = 'profileSettings-636172'
  const old = { key, value: { hideComments: true, hideLiveChat: true }, updatedAt: 10 }
  // The other device used the shared Hide Comments again at 30, and hid live chat at 35.
  const remoteEntry = {
    key,
    value: { hideLiveChat: true, iconPack: 'remix' },
    updatedAt: 35,
    settingsUpdatedAt: { hideComments: 30, hideLiveChat: 10, iconPack: 35 },
  }
  // This device showed comments at 20, before the other device's removal.
  const earlier = mergeProfileSettingsEntry({
    key,
    value: { hideComments: false, hideLiveChat: true },
    old,
    remoteEntry,
    localUpdatedAt: 20,
    localSettingUpdatedAt: id => ({ hideComments: 20 })[id],
    now: 50,
  })
  assert.equal(earlier, remoteEntry)

  // This device used the shared value of Hide Live Chat again at 40, after
  // the other device's last edit, so the removal reaches the other devices.
  const removed = mergeProfileSettingsEntry({
    key,
    value: { hideComments: false },
    old,
    remoteEntry,
    localUpdatedAt: 40,
    localSettingUpdatedAt: id => ({ hideComments: 20, hideLiveChat: 40 })[id],
    now: 50,
  })
  assert.deepEqual(removed.value, { iconPack: 'remix' })
  assert.deepEqual(removed.settingsUpdatedAt, { hideComments: 30, hideLiveChat: 40, iconPack: 35 })
})

test('profile settings synced without edit times of their own count as edited with the whole entry', () => {
  const key = 'profileSettings-636172'
  const old = { key, value: { hideComments: false, preferredCaptionLocale: 'en' }, updatedAt: 10 }
  // An entry from a version that synced no edit times per setting
  const remoteEntry = { key, value: { hideComments: false, preferredCaptionLocale: 'de' }, updatedAt: 30 }
  const value = { hideComments: true, preferredCaptionLocale: 'fr' }
  // Edits this device saved before it recorded them per setting count as edited with the profile's settings.
  const later = mergeProfileSettingsEntry({ key, value, old, remoteEntry, localUpdatedAt: 40, now: 50 })
  assert.deepEqual(later.value, value)
  assert.deepEqual(later.settingsUpdatedAt, { hideComments: 40, preferredCaptionLocale: 40 })

  const entry = mergeProfileSettingsEntry({
    key, value, old, remoteEntry, localUpdatedAt: 40, localSettingUpdatedAt: id => ({ hideComments: 40, preferredCaptionLocale: 20 })[id], now: 50,
  })
  assert.deepEqual(entry.value, { hideComments: true, preferredCaptionLocale: 'de' })
  assert.deepEqual(entry.settingsUpdatedAt, { hideComments: 40, preferredCaptionLocale: 30 })
})

test('hidden channels added and removed on two devices before they sync are all kept', () => {
  const channel = (name, preferredName = '') => ({ name, preferredName })
  const old = { key: 'channelsHidden', value: JSON.stringify([channel('UC-a'), channel('UC-b')]), updatedAt: 10 }
  // The other device hid C and unhid A; this device fetched B's name, hid D, and unhid nothing.
  const remoteEntry = { key: 'channelsHidden', value: JSON.stringify([channel('UC-b'), channel('UC-c')]), updatedAt: 30 }
  const value = JSON.stringify([channel('UC-a'), channel('UC-b', 'Channel B'), channel('UC-d')])
  const entry = mergeSettingListEntry({ key: 'channelsHidden', value, old, remoteEntry, localUpdatedAt: 20, now: 40 })
  assert.deepEqual(JSON.parse(entry.value), [channel('UC-b', 'Channel B'), channel('UC-c'), channel('UC-d')])
  assert.ok(entry.updatedAt >= remoteEntry.updatedAt, 'The merged list must replace the server list on other devices')

  const unchanged = mergeSettingListEntry({ key: 'channelsHidden', value: old.value, old, remoteEntry, now: 40 })
  assert.equal(unchanged, remoteEntry, 'An unedited list must take the server list')

  const firstSync = mergeSettingListEntry({
    key: 'forbiddenTitles',
    value: '["local"]',
    old: undefined,
    remoteEntry: { key: 'forbiddenTitles', value: '["remote"]', updatedAt: 30 },
    now: 40,
  })
  assert.deepEqual(JSON.parse(firstSync.value), ['remote', 'local'], 'A first sync must keep both devices\' items')
})
