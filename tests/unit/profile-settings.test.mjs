import { DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { MAIN_PROFILE_ID } from '../../src/constants.js'
import * as profileSettings from '../../src/profileSettings.js'
import * as subscriptionSync from '../../src/renderer/helpers/subscription-settings-sync.js'
import * as playlistPreferencesSync from '../../src/renderer/helpers/playlist-preferences-sync.js'
import { areSyncSettingValuesEqual, isListSetting, mergeSettingEntry, mergeSettingItemsEntry, mergeSettingListEntry, mergeProfileSettingsEntry, migrateLegacySyncedSettings, profileSettingTimesOf, resolveMergedThemeEntry } from '../../src/renderer/helpers/sync-settings-conflict.js'

const { collectProfileSettings, planProfileSettingsOf, profileIdFromSettingsId, profileSettingsId, profileSettingEditTimeId } = profileSettings

test('profile settings IDs name exactly one profile, also when the server sends malformed keys', () => {
  for (const profileId of ['A1b2C3d4E5f6G7h8', 'Профиль 🚗', '\uFEFFcar']) {
    assert.equal(profileIdFromSettingsId(profileSettingsId(profileId)), profileId)
  }
  const car = profileSettingsId('car')
  for (const key of [car.toUpperCase(), `${car}0`, `${car}zz`, 'profileSettings-', `profileSettings-${Buffer.from(MAIN_PROFILE_ID).toString('hex')}`, 'uiScale']) {
    assert.equal(profileIdFromSettingsId(key), null, key)
  }
  // Another device can save the keys of nested values in another order.
  assert.ok(profileSettings.sameSettingValue({ a: { x: 1, y: [{ p: 1, q: 2 }] } }, { a: { y: [{ q: 2, p: 1 }], x: 1 } }))
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
  mergeProfileSettingsEntry,
  profileSettingTimesOf,
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
  assert.deepEqual(json(second.saved), [{ profileId: 'car', settings: { hideComments: true }, previous: null, updatedAt: {} }])
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
  assert.deepEqual(json(client.entries.find(entry => entry.key === unknown.key)), unknown)
})

test('a profile that arrives after a sync gets the settings waiting for it on the server', async () => {
  const car = profileSettingsId('car')
  const entry = { key: car, value: { hideComments: true }, updatedAt: 1 }
  const client = createClient([entry])
  // This device syncs before it has the car profile, which arrives later.
  const device = createDevice({})
  const carProfile = device.state.profiles.profileList.pop()
  const snapshot = await context.syncSettings(client, device)
  device.state.profiles.profileList.push(carProfile)
  await context.syncSettings(client, device, snapshot)
  assert.deepEqual(JSON.parse(JSON.stringify(client.entries.find(item => item.key === car))), entry)
  assert.deepEqual(JSON.parse(JSON.stringify(device.state.settings.profileSettingsState.overrides)), { car: { hideComments: true } })
})

test('an upload keeps the profile settings that only other devices sync', async () => {
  const car = profileSettingsId('car')
  const client = createClient([{ key: car, value: { hideComments: false, uiScale: 150 }, updatedAt: 1 }])
  // This device doesn't sync uiScale and changed hideComments after the server's entry.
  const device = createDevice({ car: { hideComments: true } })
  device.state.settings.syncServerSettingUpdatedAt[car] = 2
  const previous = { [car]: { key: car, value: { hideComments: false, uiScale: 150 }, updatedAt: 1 } }
  await context.syncSettings(client, device, previous)
  assert.deepEqual(JSON.parse(JSON.stringify(client.entries.find(entry => entry.key === car))), {
    key: car, value: { hideComments: true, uiScale: 150 }, updatedAt: 2, settingsUpdatedAt: { hideComments: 2, uiScale: 1 },
  })
})

test('sync merges a profile\'s own settings by when this device edited each of them', async () => {
  const car = profileSettingsId('car')
  const old = { key: car, value: { hideComments: false, hideLiveChat: false }, updatedAt: 10 }
  // The other device hid live chat at 30, and this device hid it at 20 and comments at 40.
  const client = createClient([{
    key: car, value: { hideComments: false, hideLiveChat: 'later' }, updatedAt: 30, settingsUpdatedAt: { hideComments: 10, hideLiveChat: 30 },
  }])
  const device = createDevice({ car: { hideComments: true, hideLiveChat: true } })
  Object.assign(device.state.settings.syncServerSettingUpdatedAt, {
    [car]: 40, [profileSettingEditTimeId(car, 'hideComments')]: 40, [profileSettingEditTimeId(car, 'hideLiveChat')]: 20,
  })
  await context.syncSettings(client, device, { [car]: old })
  assert.deepEqual(JSON.parse(JSON.stringify(client.entries.find(entry => entry.key === car))), {
    key: car, value: { hideComments: true, hideLiveChat: 'later' }, updatedAt: 40, settingsUpdatedAt: { hideComments: 40, hideLiveChat: 30 },
  })
})

test('profile settings edited while a sync saves keep their last synced baseline', async () => {
  const car = profileSettingsId('car')
  // The other device hid comments, both for everyone and for the car profile.
  const client = createClient([
    { key: 'hideComments', value: true, updatedAt: 2 },
    { key: car, value: { hideComments: true }, updatedAt: 2 },
  ])
  const previous = {
    hideComments: { key: 'hideComments', value: false, updatedAt: 1 },
    [car]: { key: car, value: { hideComments: false }, updatedAt: 1 },
  }
  const device = createDevice({ car: { hideComments: false } })
  const { overrides } = device.state.settings.profileSettingsState
  const saveSyncedProfileSettings = device.dispatch
  device.dispatch = async (action, payload) => {
    if (action === 'saveSyncedProfileSettings') return saveSyncedProfileSettings(action, payload)
    // The car profile hides live chat while the shared setting saves.
    device.state.settings.hideComments = payload
    overrides.car = { hideComments: false, hideLiveChat: true }
  }
  const snapshot = await context.syncSettings(client, device, previous)
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot[car])), previous[car])

  // The next sync keeps the other device's edit and adds this one.
  await context.syncSettings(client, device, snapshot)
  assert.deepEqual(JSON.parse(JSON.stringify(client.entries.find(entry => entry.key === car).value)), {
    hideComments: true, hideLiveChat: true,
  })
})

test('a profile setting this device starts syncing keeps the value other devices synced', async () => {
  const car = profileSettingsId('car')
  const json = value => JSON.parse(JSON.stringify(value))
  const client = createClient([{ key: car, value: { hideLiveChat: true }, updatedAt: 1 }])
  // This device doesn't sync Hide Live Chat yet, and its car profile shows the shared value.
  const device = createDevice({ car: {} })
  device.state.settings.syncServerSettingsExcluded.push('hideLiveChat')
  const snapshot = await context.syncSettings(client, device)

  device.state.settings.syncServerSettingsExcluded.pop()
  await context.syncSettings(client, device, snapshot)
  assert.deepEqual(json(client.entries.find(entry => entry.key === car).value), { hideLiveChat: true })
  assert.deepEqual(json(device.state.settings.profileSettingsState.overrides.car), { hideLiveChat: true })
})

test('a retry after a rejected upload keeps the profile settings edits the server never received', async () => {
  const car = profileSettingsId('car')
  const json = value => JSON.parse(JSON.stringify(value))
  const client = createClient([{ key: car, value: { hideComments: false }, updatedAt: 1 }])
  const previous = { [car]: { key: car, value: { hideComments: false }, updatedAt: 1 } }
  // This device hid comments for the car profile. Encrypted sync uploads the
  // merged document later, and the server rejects it for a newer revision.
  const device = createDevice({ car: { hideComments: true } })
  device.state.settings.syncServerSettingUpdatedAt[car] = 2
  let retryBaseline
  const rejected = await context.syncSettings(createClient(client.entries), device, previous, null, {
    onRetryBaseline: getBaseline => { retryBaseline = getBaseline },
  })

  // Meanwhile, another device hid live chat for it.
  client.entries = [{ key: car, value: { hideComments: false, hideLiveChat: true }, updatedAt: 3 }]
  await context.syncSettings(client, device, rejected, null, { listSnapshot: retryBaseline() })
  assert.deepEqual(json(client.entries.find(entry => entry.key === car).value), { hideComments: true, hideLiveChat: true })
  assert.deepEqual(json(device.state.settings.profileSettingsState.overrides.car), { hideComments: true, hideLiveChat: true })
})

test('settings edited and changed back while a sync saves keep that edit', async () => {
  const car = profileSettingsId('car')
  const carHideLiveChat = profileSettingEditTimeId(car, 'hideLiveChat')
  const json = value => JSON.parse(JSON.stringify(value))
  // Another device hid comments, live chat, and live chat for the car profile at 30.
  const client = createClient([
    { key: 'hideComments', value: true, updatedAt: 30 },
    { key: 'hideLiveChat', value: true, updatedAt: 30 },
    { key: car, value: { hideLiveChat: true }, updatedAt: 30, settingsUpdatedAt: { hideLiveChat: 30 } },
  ])
  const previous = {
    hideComments: { key: 'hideComments', value: false, updatedAt: 10 },
    hideLiveChat: { key: 'hideLiveChat', value: false, updatedAt: 10 },
    [car]: { key: car, value: { hideLiveChat: false }, updatedAt: 10, settingsUpdatedAt: { hideLiveChat: 10 } },
  }
  const device = createDevice({ car: { hideLiveChat: false } })
  const { settings } = device.state
  settings.hideLiveChat = false
  Object.assign(settings.syncServerSettingUpdatedAt, { hideComments: 10, hideLiveChat: 10, [car]: 10, [carHideLiveChat]: 10 })
  const applied = []
  const saveSyncedProfileSettings = device.dispatch
  device.dispatch = async (action, payload) => {
    if (action === 'saveSyncedProfileSettings') return saveSyncedProfileSettings(action, payload)
    applied.push(action)
    if (action === 'updateHideComments') {
      settings.hideComments = payload
      // While Hide Comments saves, this device shows live chat at 35 and hides
      // it again at 40, both for everyone and for the car profile.
      settings.syncServerSettingUpdatedAt = { ...settings.syncServerSettingUpdatedAt, hideLiveChat: 40, [car]: 40, [carHideLiveChat]: 40 }
    }
  }
  const syncableSettingKeys = context.getSyncableSettingKeys
  context.getSyncableSettingKeys = () => ['hideComments', 'hideLiveChat']
  try {
    const snapshot = await context.syncSettings(client, device, previous)
    assert.deepEqual(applied, ['updateHideComments'])
    assert.deepEqual(device.saved, [])

    // The next sync uploads the edits at 40, which are newer than the other device's.
    await context.syncSettings(client, device, snapshot)
    assert.deepEqual(json(client.entries.find(entry => entry.key === 'hideLiveChat')), { key: 'hideLiveChat', value: false, updatedAt: 40 })
    assert.deepEqual(json(client.entries.find(entry => entry.key === car).value), { hideLiveChat: false })
    assert.deepEqual(applied, ['updateHideComments'])
    assert.equal(settings.hideLiveChat, false)
  } finally {
    context.getSyncableSettingKeys = syncableSettingKeys
  }
})

test('sync keeps a shared setting that another window edited and this one hasn\'t received yet', async () => {
  const client = createClient([{ key: 'hideComments', value: true, updatedAt: 30 }])
  const previous = { hideComments: { key: 'hideComments', value: false, updatedAt: 10 } }
  const device = createDevice({})
  device.state.settings.syncServerSettingUpdatedAt.hideComments = 10
  // Another window hid comments at 35 and showed them again at 40.
  let saved = { hideComments: 40 }
  device.readSavedSettingEditTimes = async () => saved
  const applied = []
  device.dispatch = async action => { applied.push(action) }
  const snapshot = await context.syncSettings(client, device, previous)
  assert.deepEqual(applied, [])
  assert.equal(client.entries.find(entry => entry.key === 'hideComments').updatedAt, 30)

  // Once this window has the edit, the next sync uploads it.
  device.state.settings.syncServerSettingUpdatedAt.hideComments = 40
  saved = { hideComments: 40 }
  await context.syncSettings(client, device, snapshot)
  assert.deepEqual(applied, [])
  assert.deepEqual(JSON.parse(JSON.stringify(client.entries.find(entry => entry.key === 'hideComments'))), { key: 'hideComments', value: false, updatedAt: 40 })
})

const settingsSource = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
/** The source of settings.js from `start` up to `end`, which must both be in it */
const between = (start, end) => {
  const from = settingsSource.indexOf(start)
  const to = settingsSource.indexOf(end, from)
  assert.ok(from !== -1 && to !== -1, `settings.js no longer contains ${from === -1 ? start : end}`)
  return settingsSource.slice(from, to)
}

test('a saved edit of a profile setting keeps the optimistic edits still saving', async () => {
  const { createSettingUpdateQueue, createSettingWriteTracker } = await import('../../src/renderer/helpers/settingUpdateQueue.js')
  const id = profileSettingsId('car')
  const saved = new Map([[id, {}]])
  const releases = []
  const overrides = { car: {} }
  const editedParts = []
  let unreadable = false
  let unwritable = false
  // Objects from the other context have another prototype.
  const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  const mutations = vm.runInNewContext(`({${between('  setProfileOwnSettings: (state', '  // Takes a plan from')}})`, {
    isPlainObject,
    ownSettingsOf: profileSettings.ownSettingsOf,
    withPendingProfileEdits: (...args) => region.withPendingProfileEdits(...args),
  })
  const state = { quickSettings: ['shared'], profileSettingsState: { overrides } }
  const commit = (type, payload) => mutations[type](state, payload)
  const settingWrites = createSettingWriteTracker(async key => structuredClone(saved.get(key)))
  const region = vm.runInNewContext(`${between('function saveProfileSettingValue(', '/** Mutations that can change which settings show')}
({ updateProfileSetting, withPendingProfileEdits })`, {
    ...profileSettings,
    state,
    isPlainObject,
    createSettingUpdateQueue,
    settingWrites,
    runLocked: (_name, run) => run(),
    saveSettingEdit: (_commit, _id, save, _editedAt, parts) => {
      editedParts.push(...parts)
      return save()
    },
    DBSettingHandlers: {
      findValue: async key => {
        if (unreadable) throw new Error('The settings cannot be read')
        return structuredClone(saved.get(key))
      },
      // Each save waits until the test lets it finish.
      upsert: async (key, value) => {
        if (unwritable) throw new Error('The settings cannot be saved')
        await new Promise(resolve => releases.push(() => {
          saved.set(key, structuredClone(value))
          resolve()
        }))
      },
    },
    console,
  })
  // Waits until `edit` starts its save, and fails if it settles before.
  const untilSaving = async edit => {
    let settled = false
    edit.then(() => { settled = true })
    while (releases.length === 0) {
      assert.ok(!settled, 'the edit finished without saving')
      await new Promise(resolve => setImmediate(resolve))
    }
  }

  // Add A, then add B while A saves, like the quick settings customizer.
  const first = region.updateProfileSetting(commit, 'car', 'quickSettings', ['a'], true)
  await untilSaving(first)
  const second = region.updateProfileSetting(commit, 'car', 'quickSettings', ['a', 'b'], true)
  releases.shift()()
  await first
  assert.deepEqual(JSON.parse(JSON.stringify(overrides.car.quickSettings)), ['a', 'b'])
  await untilSaving(second)
  releases.shift()()
  await second
  assert.deepEqual(JSON.parse(JSON.stringify([saved.get(id), overrides.car])), [{ quickSettings: ['a', 'b'] }, { quickSettings: ['a', 'b'] }])

  // Setting the shared value saves no own value, so the profile follows later shared changes.
  const third = region.updateProfileSetting(commit, 'car', 'quickSettings', ['shared'], true)
  await untilSaving(third)
  releases.shift()()
  assert.equal(await third, true)
  assert.deepEqual(JSON.parse(JSON.stringify([saved.get(id), overrides.car])), [{}, {}])
  // Each edit, also back to the shared value, saves when it edited the setting, for sync.
  assert.deepEqual(editedParts, Array(3).fill(profileSettingEditTimeId(id, 'quickSettings')))

  // A failed edit shows the saved value again, also when the settings can't be read to restore it.
  unreadable = true
  assert.equal(await region.updateProfileSetting(commit, 'car', 'quickSettings', ['c'], true), false)
  assert.deepEqual(JSON.parse(JSON.stringify(overrides.car)), {})

  // Another window saves the profile's settings right after this one's edit
  // saved. They show once the edit finishes.
  unreadable = false
  const fourth = region.updateProfileSetting(commit, 'car', 'quickSettings', ['d'], true)
  await untilSaving(fourth)
  settingWrites.savedElsewhere(id, settings => commit('setProfileOwnSettings', { profileId: 'car', settings }))
  releases.shift()()
  saved.set(id, { quickSettings: ['e'] })
  assert.equal(await fourth, true)
  assert.deepEqual(JSON.parse(JSON.stringify(overrides.car)), { quickSettings: ['e'] })

  // An edit the next one replaced before it saved confirms no value, so when
  // the next one fails, the last saved value shows again.
  unwritable = true
  unreadable = true
  const skipped = region.updateProfileSetting(commit, 'car', 'quickSettings', ['f'], true)
  const failed = region.updateProfileSetting(commit, 'car', 'quickSettings', ['g'], true)
  assert.deepEqual(await Promise.all([skipped, failed]), [true, false])
  assert.deepEqual(JSON.parse(JSON.stringify(overrides.car)), { quickSettings: ['e'] })
})

test('sync saves a profile\'s own settings only if none was edited since it read them', async () => {
  const id = profileSettingsId('car')
  const hideLiveChat = profileSettingEditTimeId(id, 'hideLiveChat')
  // Sync read Hide Live Chat off, edited at 10. Another window turned it on at
  // 35 and off again at 40 before the sync saved.
  const saved = new Map([[id, { hideLiveChat: false }], ['syncServerSettingUpdatedAt', { [id]: 40, [hideLiveChat]: 40 }]])
  const committed = []
  const { saveSyncedProfileSettings } = vm.runInNewContext(`({${between('  saveSyncedProfileSettings: (', '  resetSettingToDefault:')}})`, {
    ...profileSettings,
    sanitizeProfileSettings: settings => profileSettings.profileSettingsOf(settings, () => true),
    syncedProfileSettings: profileSettings.syncedProfileSettingsOf,
    settingWrites: { track: (_id, run) => run() },
    runLockedSettingUpdate: (_id, run) => run().then(() => true),
    profileExists: async () => true,
    readSavedSettingEditTimes: async () => structuredClone(saved.get('syncServerSettingUpdatedAt')),
    DBSettingHandlers: {
      findValue: async key => structuredClone(saved.get(key)),
      upsert: async (key, value) => { saved.set(key, structuredClone(value)) },
    },
  })
  const commit = (type, payload) => committed.push([type, payload])
  const save = updatedAt => saveSyncedProfileSettings({ commit }, {
    profileId: 'car', settings: { hideLiveChat: true }, previous: { hideLiveChat: false }, updatedAt, isSynced: () => true,
  })

  assert.equal(await save({ [id]: 10, [hideLiveChat]: 10 }), false)
  assert.deepEqual(JSON.parse(JSON.stringify(saved.get(id))), { hideLiveChat: false })
  assert.deepEqual(committed, [])

  assert.equal(await save({ [id]: 40, [hideLiveChat]: 40 }), true)
  assert.deepEqual(JSON.parse(JSON.stringify(saved.get(id))), { hideLiveChat: true })
})

test('a failed shared write of a setting the active profile replaces keeps the previous shared value', async () => {
  const { createOptimisticSettingUpdater, createSettingWriteTracker } = await import('../../src/renderer/helpers/settingUpdateQueue.js')
  // The car profile shows its own order while the shared one is kept aside.
  const settings = { quickSettings: ['car'], profileSettingsState: { applied: 'car', shared: { quickSettings: ['shared'] } } }
  const { updateOrderedSetting } = vm.runInNewContext(`${between('function updateOrderedSetting(', 'const editSavedSetting')}
({ updateOrderedSetting })`, {
    ...profileSettings,
    // Sync and imports save the shared settings, see `withSharedSettings`.
    settingTarget: () => null,
    updateOptimisticSetting: createOptimisticSettingUpdater(),
    settingWrites: createSettingWriteTracker(async () => undefined),
    defaultMutationId: settingId => `set${settingId}`,
    saveSettingEdit: async () => { throw new Error('The datastore is unavailable') },
    console: { error() {} },
  })
  // Like `set<Setting>` mutations, see `assignSharedSetting`.
  const commit = (_type, value) => { settings.profileSettingsState.shared.quickSettings = value }
  assert.equal(await updateOrderedSetting(commit, settings, 'quickSettings', ['synced']), false)
  assert.deepEqual(JSON.parse(JSON.stringify(settings)), {
    quickSettings: ['car'], profileSettingsState: { applied: 'car', shared: { quickSettings: ['shared'] } },
  })
})

test('replacing the active profile\'s own settings with others of the same value tracks the new shared values', () => {
  const sideEffects = []
  const { applyActiveProfileSettings } = vm.runInNewContext(`${between('function applyActiveProfileSettings(', '/**\n * Runs what a setting does')}
({ applyActiveProfileSettings })`, {
    ...profileSettings,
    applySettingSideEffects: (_store, settingId) => sideEffects.push(settingId),
    canHaveOwnSettings: () => true,
    process: { env: {} },
    planProfileSettings: (settings, target) => planProfileSettingsOf(settings, target, () => true),
  })
  const settings = { hideComments: false, hideLiveChat: false, profileSettingsState: { applied: null, shared: {}, overrides: { car: { hideComments: false } } } }
  const store = {
    state: { settings, profiles: { activeProfile: 'car', profilesLoaded: true } },
    commit(type, { applied, shared, values }) {
      assert.equal(type, 'applyProfileSettings')
      Object.assign(settings.profileSettingsState, { applied, shared })
      Object.assign(settings, values)
    },
  }
  applyActiveProfileSettings(store)
  assert.deepEqual(Object.keys(settings.profileSettingsState.shared), ['hideComments'])
  // The switch selects the icon pack again, so one still loading for the previous profile doesn't show.
  assert.deepEqual(sideEffects.splice(0), ['iconPack'])
  // Sync replaces them with another setting that already shows its value.
  settings.profileSettingsState.overrides.car = { hideLiveChat: false }
  applyActiveProfileSettings(store)
  assert.deepEqual(Object.keys(settings.profileSettingsState.shared), ['hideLiveChat'])
  assert.deepEqual(sideEffects, [])
})
