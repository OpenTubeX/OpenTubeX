import { DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { MAIN_PROFILE_ID } from '../../src/constants.js'
import * as profileSettings from '../../src/profileSettings.js'
import * as subscriptionSync from '../../src/renderer/helpers/subscription-settings-sync.js'
import * as playlistPreferencesSync from '../../src/renderer/helpers/playlist-preferences-sync.js'
import { areSyncSettingValuesEqual, isListSetting, mergeSettingEntry, mergeSettingItemsEntry, mergeSettingListEntry, migrateLegacySyncedSettings, resolveMergedThemeEntry } from '../../src/renderer/helpers/sync-settings-conflict.js'

const { collectProfileSettings, planProfileSettingsOf, profileIdFromSettingsId, profileSettingsId } = profileSettings

test('profile settings IDs name exactly one profile, also when the server sends malformed keys', () => {
  for (const profileId of ['A1b2C3d4E5f6G7h8', 'Профиль 🚗']) {
    assert.equal(profileIdFromSettingsId(profileSettingsId(profileId)), profileId)
  }
  const car = profileSettingsId('car')
  for (const key of [car.toUpperCase(), `${car}0`, `${car}zz`, 'profileSettings-', `profileSettings-${Buffer.from(MAIN_PROFILE_ID).toString('hex')}`, 'uiScale']) {
    assert.equal(profileIdFromSettingsId(key), null, key)
  }
  // Datastore records with other values hold no own settings.
  assert.deepEqual(collectProfileSettings([
    { _id: car, value: { hideComments: true } },
    { _id: profileSettingsId('shared'), value: null },
    { _id: 'hideComments', value: false },
  ]), { car: { hideComments: true } })
})

test('switching profiles shows each profile\'s own values and brings back the shared values edited meanwhile', () => {
  const isProfileSpecific = key => key !== 'syncServerToken'
  const settings = {
    hideComments: false,
    uiScale: 100,
    syncServerToken: 'shared',
    profileSettingsState: {
      applied: null,
      shared: {},
      overrides: {
        car: { hideComments: true, syncServerToken: 'ignored' },
        kids: { hideComments: true, uiScale: 150 },
      },
    },
  }
  // Like the settings module: plans apply as one mutation, and `set<Setting>`
  // mutations set the shared value, kept aside while a profile replaces it.
  const apply = target => {
    const plan = planProfileSettingsOf(settings, target, isProfileSpecific)
    settings.profileSettingsState.applied = plan.applied
    settings.profileSettingsState.shared = plan.shared
    Object.assign(settings, plan.values)
    return plan.changed
  }
  const setShared = (key, value) => {
    if (Object.hasOwn(settings.profileSettingsState.shared, key)) settings.profileSettingsState.shared[key] = value
    else settings[key] = value
  }

  assert.deepEqual(apply('car'), ['hideComments'])
  assert.equal(settings.hideComments, true)
  assert.equal(settings.syncServerToken, 'shared')
  // Sync saves shared values while the profile shows its own.
  setShared('hideComments', 'synced')
  setShared('uiScale', 110)
  assert.equal(settings.hideComments, true)
  assert.equal(settings.uiScale, 110)

  // Only values that change run their side effects.
  assert.deepEqual(apply('kids'), ['uiScale'])
  assert.equal(settings.uiScale, 150)
  assert.deepEqual(settings.profileSettingsState.shared, { hideComments: 'synced', uiScale: 110 })

  assert.deepEqual(apply(null).sort(), ['hideComments', 'uiScale'])
  assert.equal(settings.hideComments, 'synced')
  assert.equal(settings.uiScale, 110)
  assert.deepEqual(settings.profileSettingsState.shared, {})
})

const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const context = vm.createContext({
  DEFAULT_CHANNEL_AVATAR,
  UNKNOWN_SYNC_UPLOADER_ID,
  uploaderToLocal,
  normalizeChannelAvatar,
  enrichSyncVideo,
  mergeSyncIds,
  syncVideoToRemote,
  ...subscriptionSync,
  ...playlistPreferencesSync,
  ...profileSettings,
  areSyncSettingValuesEqual,
  mergeSettingEntry,
  mergeSettingItemsEntry,
  isListSetting,
  mergeSettingListEntry,
  migrateLegacySyncedSettings,
  resolveMergedThemeEntry,
  CUSTOM_THEMES_SYNC_KEY: 'customThemes',
  normalizeCustomThemes: value => value,
  getSyncableSettingKeys: () => ['hideComments'],
  isSettingSyncEnabled: (settings, settingKey) => !settings.syncServerSettingsExcluded.includes(settingKey),
  settingWritesSettled: () => null,
  syncedProfileSettings: profileSettings.syncedProfileSettingsOf,
  withSharedSettings: operation => operation(),
  deepCopy: structuredClone,
})
vm.runInContext(source
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export \{[\s\S]*?\}\n/gm, '')
  .replace(/^export (?=(async )?(function|class|const))/gm, ''), context)

/** A device with the main profile and `car`, whose own settings are `overrides` */
function createDevice(overrides) {
  const saved = []
  const settings = {
    hideComments: false,
    syncServerSettingsExcluded: ['uiScale', 'subscriptionChannelSettings'],
    syncServerSettingUpdatedAt: {},
    profileSettingsState: { applied: null, shared: {}, overrides },
  }
  return {
    saved,
    state: {
      settings,
      profiles: { profileList: [{ _id: MAIN_PROFILE_ID, subscriptions: [] }, { _id: 'car', subscriptions: [] }] },
      utils: { customThemes: [] },
    },
    async dispatch(action, payload) {
      assert.equal(action, 'saveSyncedProfileSettings')
      saved.push(payload)
      if (payload.settings === null) delete overrides[payload.profileId]
      else overrides[payload.profileId] = payload.settings
      return true
    },
  }
}

function createClient(entries = []) {
  return {
    entries,
    async getSettings() { return structuredClone(this.entries) },
    async putSettings(value) { this.entries = structuredClone(value) },
  }
}

test('a profile\'s own settings sync to the same profile on another device, apart from the shared ones', async () => {
  const car = profileSettingsId('car')
  // A profile only the server knows about must neither be applied nor dropped.
  const unknown = { key: profileSettingsId('other'), value: { hideComments: true }, updatedAt: 1 }
  const client = createClient([unknown])

  const first = createDevice({ car: { uiScale: 150, hideComments: true } })
  // The car profile is active, so the state shows its value instead of the shared one.
  first.state.settings.hideComments = true
  first.state.settings.profileSettingsState = { ...first.state.settings.profileSettingsState, applied: 'car', shared: { hideComments: false } }
  const firstSnapshot = await context.syncSettings(client, first)
  assert.equal(client.entries.find(entry => entry.key === 'hideComments').value, false)
  // Settings this device doesn't sync stay on it.
  assert.deepEqual(JSON.parse(JSON.stringify(client.entries.find(entry => entry.key === car).value)), { hideComments: true })
  assert.deepEqual(JSON.parse(JSON.stringify(client.entries.find(entry => entry.key === unknown.key))), unknown)

  const second = createDevice({})
  const secondSnapshot = await context.syncSettings(client, second)
  // Values from the sync context compare by their JSON.
  const json = value => JSON.parse(JSON.stringify(value))
  assert.deepEqual(json(second.saved), [{ profileId: 'car', settings: { hideComments: true }, previous: null }])
  assert.deepEqual(json(second.state.settings.profileSettingsState.overrides), { car: { hideComments: true } })
  assert.equal(second.state.settings.hideComments, false)
  assert.ok(!second.saved.some(payload => payload.profileId === 'other'))

  // Turning the car profile's own settings off on the first device turns them off on the second.
  delete first.state.settings.profileSettingsState.overrides.car
  first.state.settings.syncServerSettingUpdatedAt[car] = Date.now() + 1000
  await context.syncSettings(client, first, firstSnapshot)
  assert.equal(client.entries.find(entry => entry.key === car).value, null)
  second.saved.length = 0
  await context.syncSettings(client, second, secondSnapshot)
  assert.deepEqual(json(second.saved.map(({ profileId, settings }) => ({ profileId, settings }))), [{ profileId: 'car', settings: null }])
  assert.deepEqual(json(second.state.settings.profileSettingsState.overrides), {})
  assert.deepEqual(json(client.entries.find(entry => entry.key === unknown.key)), unknown)
})
