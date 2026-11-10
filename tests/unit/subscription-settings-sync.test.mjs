import { DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { DEFAULT_PROFILE_ICON } from '../../src/renderer/helpers/profileIcons.js'
import { copySubscriptionChannelSettings, getChannelWithUpdatedSettings, getNextSubscriptionSettingsTimestamp, isValidSubscriptionSettingsTimestamp } from '../../src/renderer/helpers/subscription-channels.js'
import * as subscriptionSync from '../../src/renderer/helpers/subscription-settings-sync.js'
import { areSyncSettingValuesEqual, mergeSettingEntry, mergeSettingItemsEntry, migrateLegacySyncedSettings, resolveMergedThemeEntry } from '../../src/renderer/helpers/sync-settings-conflict.js'
import * as playlistPreferencesSync from '../../src/renderer/helpers/playlist-preferences-sync.js'

const key = subscriptionSync.SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY
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
  areSyncSettingValuesEqual,
  mergeSettingEntry,
  mergeSettingItemsEntry,
  migrateLegacySyncedSettings,
  resolveMergedThemeEntry,
  CUSTOM_THEMES_SYNC_KEY: 'customThemes',
  normalizeCustomThemes: value => value,
  getSyncableSettingKeys: () => [],
  isSettingSyncEnabled: (settings, settingKey) => !settings.syncServerSettingsExcluded.includes(settingKey),
  deepCopy: structuredClone,
})
vm.runInContext(source
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export \{[\s\S]*?\}\n/gm, '')
  .replace(/^export (?=(async )?(function|class|const))/gm, ''), context)

function createStore(channels, excluded = []) {
  const profiles = [{ subscriptions: structuredClone(channels) }, { subscriptions: structuredClone(channels) }]
  return {
    state: {
      profiles: { profileList: profiles },
      settings: { syncServerSettingsExcluded: excluded },
      utils: { customThemes: [] },
    },
    dispatch: async (action, { channelId, settings, fromSync, updatedAt }) => {
      assert.equal(fromSync, true)
      assert.equal(action, 'updateChannelSettings')
      for (const profile of profiles) {
        Object.assign(profile.subscriptions.find(channel => channel.id === channelId), settings, { subscriptionSettingsUpdatedAt: updatedAt })
      }
      return true
    },
  }
}

function createClient(entries = []) {
  return {
    entries: entries.map(entry => ({
      ...entry,
      value: Object.fromEntries(Object.entries(entry.value).map(([id, value]) => [id, {
        value: { feedTypes: ['videos', 'shorts', 'live', 'posts'], showMembersOnly: false, ...value },
        updatedAt: entry.updatedAt,
      }]))
    })),
    async getSettings() { return this.entries },
    async putSettings(value) { this.entries = structuredClone(value) },
  }
}

test('syncs subscription settings through the existing settings collection to another device', async () => {
  const first = createStore([{ id: 'channel', name: 'Original', feedTypes: ['shorts'], notificationFeedTypes: ['posts'], dailyVideoLimit: 3, showMembersOnly: true }])
  const client = createClient()
  await context.syncSettings(client, first)
  assert.deepEqual(client.entries.find(entry => entry.key === key).value.channel.value, {
    feedTypes: ['shorts'], notificationFeedTypes: ['posts'], dailyVideoLimit: 3, showMembersOnly: true,
  })
  const second = createStore([{ id: 'channel', name: 'Local name', thumbnail: 'local-thumbnail' }])
  await context.syncSettings(client, second)
  for (const profile of second.state.profiles.profileList) {
    assert.deepEqual(profile.subscriptions[0], {
      id: 'channel',
      name: 'Local name',
      thumbnail: 'local-thumbnail',
      feedTypes: ['shorts'],
      notificationFeedTypes: ['posts'],
      dailyVideoLimit: 3,
      showMembersOnly: true,
      subscriptionSettingsUpdatedAt: client.entries.find(entry => entry.key === key).value.channel.updatedAt,
    })
  }
})

test('applies a newer remote reset to defaults including the global daily limit', async () => {
  const store = createStore([{ id: 'channel', feedTypes: [], dailyVideoLimit: null, showMembersOnly: true }])
  const client = createClient()
  const previous = await context.syncSettings(client, store)
  const entry = client.entries.find(entry => entry.key === key)
  entry.value.channel.value = { feedTypes: ['videos', 'shorts', 'live', 'posts'], showMembersOnly: false }
  entry.value.channel.updatedAt += 1
  entry.updatedAt += 1
  await context.syncSettings(client, store, previous)
  assert.equal(store.state.profiles.profileList[0].subscriptions[0].dailyVideoLimit, undefined)
  assert.equal(store.state.profiles.profileList[0].subscriptions[0].showMembersOnly, false)
  assert.deepEqual(store.state.profiles.profileList[0].subscriptions[0].feedTypes, ['videos', 'shorts', 'live', 'posts'])
})

test('disabling subscription settings sync preserves local and remote values', async () => {
  const store = createStore([{ id: 'channel', feedTypes: ['videos'] }], [key])
  store.dispatch = () => assert.fail('Excluded settings must not be applied')
  const remote = { key, value: { channel: { feedTypes: ['posts'] } }, updatedAt: 1 }
  const client = createClient([remote])
  const expected = structuredClone(client.entries[0])
  await context.syncSettings(client, store)
  assert.deepEqual(client.entries.find(entry => entry.key === key), expected)
  assert.deepEqual(store.state.profiles.profileList[0].subscriptions[0].feedTypes, ['videos'])
})

test('does not subscribe unknown channels or reset channels absent from remote settings', async () => {
  const store = createStore([{ id: 'local', dailyVideoLimit: 5 }])
  store.dispatch = () => assert.fail('Unrelated channels must not be changed')
  await subscriptionSync.applySubscriptionSettingsSync(store, { remote: { value: { dailyVideoLimit: 2 }, updatedAt: 1 } })
  assert.equal(store.state.profiles.profileList[0].subscriptions.length, 1)
  assert.equal(store.state.profiles.profileList[0].subscriptions[0].dailyVideoLimit, 5)
})

test('failed persistence aborts sync before uploading a successful snapshot', async () => {
  const store = createStore([{ id: 'channel' }])
  store.dispatch = async () => false
  const client = createClient([{ key, value: { channel: { dailyVideoLimit: 2 } }, updatedAt: 1 }])
  client.putSettings = () => assert.fail('Failed updates must be retried')
  await assert.rejects(context.syncSettings(client, store), /Failed to apply synced subscription settings/)
})

test('uploads a newer local edit using its saved edit time', async () => {
  const store = createStore([{ id: 'channel', dailyVideoLimit: 2 }])
  const client = createClient()
  const previous = await context.syncSettings(client, store)
  const entry = client.entries.find(entry => entry.key === key)
  store.state.profiles.profileList[0].subscriptions[0].subscriptionSettingsUpdatedAt = entry.updatedAt + 2
  store.state.profiles.profileList[0].subscriptions[0].dailyVideoLimit = null
  entry.value.channel.value.dailyVideoLimit = 3
  entry.value.channel.updatedAt += 1
  entry.updatedAt += 1
  await context.syncSettings(client, store, previous)
  assert.equal(client.entries.find(entry => entry.key === key).value.channel.value.dailyVideoLimit, null)
  assert.equal(client.entries.find(entry => entry.key === key).updatedAt, store.state.profiles.profileList[0].subscriptions[0].subscriptionSettingsUpdatedAt)
})

test('consecutive syncs preserve settings for channels only subscribed on another device', async () => {
  const store = createStore([{ id: 'local', dailyVideoLimit: 2 }])
  const remoteOnly = { feedTypes: ['posts'], dailyVideoLimit: 7, showMembersOnly: true }
  const client = createClient([{
    key,
    value: { local: { feedTypes: ['videos', 'shorts', 'live', 'posts'], dailyVideoLimit: 2, showMembersOnly: false }, remote: remoteOnly },
    updatedAt: 1,
  }])
  const previous = await context.syncSettings(client, store)
  await context.syncSettings(client, store, previous)
  assert.deepEqual(client.entries.find(entry => entry.key === key).value.remote.value, remoteOnly)

  store.state.profiles.profileList[0].subscriptions[0].dailyVideoLimit = null
  store.state.profiles.profileList[0].subscriptions[0].subscriptionSettingsUpdatedAt = Date.now()
  await context.syncSettings(client, store, previous)
  const synced = client.entries.find(entry => entry.key === key).value
  assert.equal(synced.local.value.dailyVideoLimit, null)
  assert.deepEqual(synced.remote.value, remoteOnly)
})

test('remote-only changes do not turn unchanged local settings into a newer local edit', async () => {
  const store = createStore([{ id: 'local', dailyVideoLimit: 2 }])
  const client = createClient([{
    key,
    value: { local: { feedTypes: ['videos', 'shorts', 'live', 'posts'], dailyVideoLimit: 2, showMembersOnly: false }, remote: { dailyVideoLimit: 7 } },
    updatedAt: 1,
  }])
  const previous = await context.syncSettings(client, store)
  const entry = client.entries.find(entry => entry.key === key)
  entry.value.local.value.dailyVideoLimit = 3
  entry.value.remote.value.dailyVideoLimit = 8
  entry.value.local.updatedAt = 2
  entry.value.remote.updatedAt = 2
  entry.updatedAt = 2
  await context.syncSettings(client, store, previous)
  assert.equal(store.state.profiles.profileList[0].subscriptions[0].dailyVideoLimit, 3)
  const synced = client.entries.find(entry => entry.key === key)
  assert.equal(synced.value.local.value.dailyVideoLimit, 3)
  assert.equal(synced.value.remote.value.dailyVideoLimit, 8)
  assert.equal(synced.updatedAt, 2)
})

test('first sync uploads local-only channels while importing shared channel settings', async () => {
  const store = createStore([{ id: 'local', dailyVideoLimit: 2 }, { id: 'shared', dailyVideoLimit: 3 }])
  const client = createClient([{ key, value: { shared: { dailyVideoLimit: 5 } }, updatedAt: 100 }])
  await context.syncSettings(client, store)
  const synced = client.entries.find(entry => entry.key === key).value
  assert.equal(synced.local.value.dailyVideoLimit, 2)
  assert.equal(synced.shared.value.dailyVideoLimit, 5)
  assert.equal(store.state.profiles.profileList[0].subscriptions[1].dailyVideoLimit, 5)
})

test('concurrent edits to different channels both survive sync', async () => {
  const store = createStore([{ id: 'first', dailyVideoLimit: 1 }, { id: 'second', dailyVideoLimit: 1 }])
  const client = createClient()
  const previous = await context.syncSettings(client, store)
  const entry = client.entries.find(entry => entry.key === key)
  const baseTime = entry.updatedAt
  store.state.profiles.profileList[0].subscriptions[0].dailyVideoLimit = 2
  store.state.profiles.profileList[0].subscriptions[0].subscriptionSettingsUpdatedAt = baseTime + 1
  entry.value.second.value.dailyVideoLimit = 3
  entry.value.second.updatedAt = baseTime + 2
  entry.updatedAt = baseTime + 2
  await context.syncSettings(client, store, previous)
  const synced = client.entries.find(entry => entry.key === key).value
  assert.equal(synced.first.value.dailyVideoLimit, 2)
  assert.equal(synced.second.value.dailyVideoLimit, 3)
})

test('an unrelated later local edit does not retimestamp a conflicting channel', async () => {
  const store = createStore([{ id: 'first', dailyVideoLimit: 1 }, { id: 'second', dailyVideoLimit: 1 }])
  const client = createClient()
  const previous = await context.syncSettings(client, store)
  const entry = client.entries.find(entry => entry.key === key)
  const baseTime = entry.updatedAt
  store.state.profiles.profileList[0].subscriptions[0].dailyVideoLimit = 2
  store.state.profiles.profileList[0].subscriptions[1].dailyVideoLimit = 4
  store.state.profiles.profileList[0].subscriptions[0].subscriptionSettingsUpdatedAt = baseTime + 1
  store.state.profiles.profileList[0].subscriptions[1].subscriptionSettingsUpdatedAt = baseTime + 3
  entry.value.first.value.dailyVideoLimit = 3
  entry.value.first.updatedAt = baseTime + 2
  entry.updatedAt = baseTime + 2
  await context.syncSettings(client, store, previous)
  const synced = client.entries.find(entry => entry.key === key).value
  assert.equal(synced.first.value.dailyVideoLimit, 3)
  assert.equal(synced.first.updatedAt, baseTime + 2)
  assert.equal(synced.second.value.dailyVideoLimit, 4)
  assert.equal(synced.second.updatedAt, baseTime + 3)
})

test('newly subscribing a retained remote channel imports its settings without a local edit', async () => {
  const store = createStore([])
  const client = createClient([{ key, value: { channel: { dailyVideoLimit: 7 } }, updatedAt: 100 }])
  const previous = await context.syncSettings(client, store)
  for (const profile of store.state.profiles.profileList) {
    profile.subscriptions.push({ id: 'channel' })
  }
  await context.syncSettings(client, store, previous)
  for (const profile of store.state.profiles.profileList) {
    assert.equal(profile.subscriptions[0].dailyVideoLimit, 7)
  }
  const synced = client.entries.find(entry => entry.key === key).value.channel
  assert.equal(synced.value.dailyVideoLimit, 7)
  assert.equal(synced.updatedAt, 100)
})

test('a newer local edit beats an older remote one for a channel missing from the last sync', async () => {
  const store = createStore([{ id: 'other', dailyVideoLimit: 1 }])
  const client = createClient()
  const previous = await context.syncSettings(client, store)
  const entry = client.entries.find(entry => entry.key === key)
  for (const profile of store.state.profiles.profileList) {
    profile.subscriptions.push({ id: 'channel', dailyVideoLimit: 9, subscriptionSettingsUpdatedAt: entry.updatedAt + 2 })
  }
  // Another device uploads an earlier edit of the same channel afterwards.
  entry.value.channel = { value: { ...entry.value.other.value, dailyVideoLimit: 7 }, updatedAt: entry.updatedAt + 1 }
  entry.updatedAt += 1
  await context.syncSettings(client, store, previous)
  assert.equal(store.state.profiles.profileList[0].subscriptions[1].dailyVideoLimit, 9)
  assert.equal(client.entries.find(entry => entry.key === key).value.channel.value.dailyVideoLimit, 9)
})

test('a failed channel write cannot advance the saved edit timestamp', async () => {
  const profilesSource = await readFile(new URL('../../src/renderer/store/modules/profiles.js', import.meta.url), 'utf8')
  let timestamp = 100
  let failWrite = true
  let persistedChannel
  const persistenceContext = vm.createContext({
    MAIN_PROFILE_ID: 'allChannels',
    THEME_BG_COLOR: '#000000',
    THEME_TEXT_COLOR: '#ffffff',
    DEFAULT_PROFILE_ICON,
    copySubscriptionChannelSettings,
    getChannelWithUpdatedSettings,
    getNextSubscriptionSettingsTimestamp,
    isValidSubscriptionSettingsTimestamp,
    deepCopy: structuredClone,
    console: { error() {} },
    DBProfileHandlers: {
      async updateChannelSettings(channel, ids) {
        if (failWrite) throw new Error('Channel write failed')
        persistedChannel = structuredClone(channel)
        return ids
      }
    },
  })
  vm.runInContext(profilesSource
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace('export default {', 'globalThis.profileModule = {'), persistenceContext)
  const module = persistenceContext.profileModule
  module.state.profileList[0].subscriptions = [{ id: 'channel', dailyVideoLimit: 1, subscriptionSettingsUpdatedAt: timestamp }]
  const result = await module.actions.updateChannelSettings({
    state: module.state,
    commit: () => assert.fail('A failed write must not commit'),
    dispatch: async () => { timestamp = 200 },
  }, { channelId: 'channel', settings: { dailyVideoLimit: 2 } })
  assert.equal(result, false)
  assert.equal(timestamp, 100)
  assert.equal(module.state.profileList[0].subscriptions[0].subscriptionSettingsUpdatedAt, 100)
  assert.equal(module.state.profileList[0].subscriptions[0].dailyVideoLimit, 1)

  failWrite = false
  const actionContext = { state: module.state, commit: (name, payload) => module.mutations[name](module.state, payload) }
  assert.equal(await module.actions.updateChannelSettings(actionContext, { channelId: 'channel', settings: { dailyVideoLimit: 2 } }), true)
  assert.equal(persistedChannel.dailyVideoLimit, 2)
  assert.ok(persistedChannel.subscriptionSettingsUpdatedAt > 100)
  assert.deepEqual(module.state.profileList[0].subscriptions[0], persistedChannel)
  assert.equal(await module.actions.updateChannelSettings(actionContext, { channelId: 'channel', settings: { dailyVideoLimit: 3 }, fromSync: true, updatedAt: 300 }), true)
  assert.equal(persistedChannel.subscriptionSettingsUpdatedAt, 300)
  for (const updatedAt of [undefined, null, '100', -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER, 1e300]) {
    assert.equal(await module.actions.updateChannelSettings(actionContext, { channelId: 'channel', settings: { dailyVideoLimit: 4 }, fromSync: true, updatedAt }), false)
    assert.equal(persistedChannel.subscriptionSettingsUpdatedAt, 300)
    assert.equal(persistedChannel.dailyVideoLimit, 3)
    assert.equal(module.state.profileList[0].subscriptions[0].subscriptionSettingsUpdatedAt, 300)
  }
})

test('rejects invalid remote edit times before dispatching channel settings', async () => {
  for (const updatedAt of [undefined, null, '100', -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER, 1e300]) {
    const store = createStore([{ id: 'channel', dailyVideoLimit: 1, subscriptionSettingsUpdatedAt: 100 }])
    store.dispatch = () => assert.fail('Invalid timestamps must not be dispatched')
    await assert.rejects(subscriptionSync.applySubscriptionSettingsSync(store, {
      channel: { value: { dailyVideoLimit: 2 }, updatedAt },
    }), /Invalid subscription settings timestamp/)
    assert.equal(store.state.profiles.profileList[0].subscriptions[0].subscriptionSettingsUpdatedAt, 100)
  }
})

test('subscribing with untouched defaults does not upload a per-channel settings record or report a settings change', async () => {
  const store = createStore([])
  const client = createClient()
  const previous = await context.syncSettings(client, store)
  const before = structuredClone(client.entries)
  for (const profile of store.state.profiles.profileList) profile.subscriptions.push({ id: 'new-channel' })
  await context.syncSettings(client, store, previous)
  assert.deepEqual(client.entries.find(entry => entry.key === key).value, {})
  const { createSyncActivity } = await import('../../src/renderer/helpers/sync-server-live.js')
  assert.equal(createSyncActivity('settings', before, client.entries, 'device', 'Laptop'), null)
})

test('explicit resets to defaults remain in the sync payload', () => {
  const store = createStore([{ id: 'reset', subscriptionSettingsUpdatedAt: 123 }])
  assert.equal(subscriptionSync.getSubscriptionSettingsForSync(store).reset.updatedAt, 123)
})

test('records from clients without notification choices keep the local bell', async () => {
  const store = createStore([{ id: 'channel', notificationFeedTypes: ['videos', 'live'] }])
  const saved = []
  store.dispatch = async (_, payload) => { saved.push(payload.settings); return true }
  await subscriptionSync.applySubscriptionSettingsSync(store, { channel: { value: { dailyVideoLimit: 2 }, updatedAt: 5 } })
  assert.deepEqual(saved[0].notificationFeedTypes, ['videos', 'live'])
  assert.equal(saved[0].dailyVideoLimit, 2)

  await subscriptionSync.applySubscriptionSettingsSync(store, { channel: { value: { notificationFeedTypes: null }, updatedAt: 6 } })
  assert.deepEqual(saved[1].notificationFeedTypes, ['videos', 'live'])
  await subscriptionSync.applySubscriptionSettingsSync(store, { channel: { value: { notificationFeedTypes: [] }, updatedAt: 7 } })
  assert.deepEqual(saved[2].notificationFeedTypes, [])
})

const playlistKey = playlistPreferencesSync.PLAYLIST_PREFERENCES_SYNC_KEY

function createPlaylistDevice(playlists, snapshot) {
  const store = {
    state: {
      playlists: { playlists: structuredClone(playlists) },
      profiles: { profileList: [{ subscriptions: [] }] },
      settings: { syncServerSettingsExcluded: [] },
      utils: { customThemes: [] },
    },
    dispatch: async (action, { playlist, previous, keepLastUpdatedAt }) => {
      assert.equal(action, 'updatePlaylistFromSync')
      assert.equal(keepLastUpdatedAt, true)
      const current = store.state.playlists.playlists.find(item => item._id === playlist._id)
      assert.deepEqual(current, previous)
      Object.assign(current, playlist)
      return true
    },
  }
  return { store, snapshot, previous: {} }
}

function createPlaylistClient(entries = []) {
  return { entries, async getSettings() { return this.entries }, async putSettings(value) { this.entries = structuredClone(value) } }
}

test('playlist preferences sync between devices that know the playlist by different local IDs', async () => {
  const client = createPlaylistClient()
  // The creating device keeps its own ID; the other device uses the server's.
  const creator = createPlaylistDevice(
    [{ _id: 'local-id', lastUpdatedAt: 1, shuffleByDefault: true, preferencesUpdatedAt: 10 }],
    { 'local-id': { remoteId: 'remote-id' } }
  )
  const other = createPlaylistDevice([{ _id: 'remote-id', lastUpdatedAt: 2 }], { 'remote-id': { remoteId: 'remote-id' } })
  creator.previous = await context.syncSettings(client, creator.store, creator.previous, creator.snapshot)
  const uploaded = client.entries.find(entry => entry.key === playlistKey).value
  assert.deepEqual(Object.keys(uploaded), ['remote-id'])

  other.previous = await context.syncSettings(client, other.store, other.previous, other.snapshot)
  assert.deepEqual(other.store.state.playlists.playlists[0], {
    _id: 'remote-id', lastUpdatedAt: 2, addVideosToTop: false, shuffleByDefault: true, removeWatchedVideos: false, preferencesUpdatedAt: 10,
  })

  // Edits to different playlists on each device both survive.
  creator.store.state.playlists.playlists.push({ _id: 'second-local', removeWatchedVideos: true, preferencesUpdatedAt: 20 })
  creator.snapshot['second-local'] = { remoteId: 'second-remote' }
  other.store.state.playlists.playlists.push({ _id: 'second-remote' })
  other.snapshot['second-remote'] = { remoteId: 'second-remote' }
  const edited = other.store.state.playlists.playlists[0]
  Object.assign(edited, { shuffleByDefault: false, addVideosToTop: true, preferencesUpdatedAt: playlistPreferencesSync.getNextPlaylistPreferencesTimestamp(edited) })
  other.previous = await context.syncSettings(client, other.store, other.previous, other.snapshot)
  creator.previous = await context.syncSettings(client, creator.store, creator.previous, creator.snapshot)
  other.previous = await context.syncSettings(client, other.store, other.previous, other.snapshot)
  assert.deepEqual(creator.store.state.playlists.playlists.map(playlistPreferencesSync.normalizePlaylistPreferences), [
    { addVideosToTop: true, shuffleByDefault: false, removeWatchedVideos: false },
    { addVideosToTop: false, shuffleByDefault: false, removeWatchedVideos: true },
  ])
  assert.deepEqual(other.store.state.playlists.playlists.map(playlistPreferencesSync.normalizePlaylistPreferences),
    creator.store.state.playlists.playlists.map(playlistPreferencesSync.normalizePlaylistPreferences))
})

test('playlist preferences without a playlist snapshot stay as the server has them', async () => {
  const remote = { key: playlistKey, value: { 'remote-id': { value: { shuffleByDefault: true }, updatedAt: 5 } }, updatedAt: 5 }
  const client = createPlaylistClient([structuredClone(remote)])
  const device = createPlaylistDevice([{ _id: 'remote-id', removeWatchedVideos: true, preferencesUpdatedAt: 9 }], null)
  device.store.dispatch = () => assert.fail('Playlists must not change without a playlist sync')
  await context.syncSettings(client, device.store, {}, null)
  assert.deepEqual(client.entries.find(entry => entry.key === playlistKey), remote)
  // Playlists the server does not have yet wait for the next playlist sync.
  assert.deepEqual(playlistPreferencesSync.getPlaylistPreferencesForSync(device.store.state.playlists.playlists, {}), {})
})

test('the newer of two unsynced edits to the same item wins even when the older one uploads first', () => {
  const older = mergeSettingItemsEntry({ key: playlistKey, value: { item: { value: { shuffleByDefault: true }, updatedAt: 100 } }, now: 300 })
  assert.equal(older.value.item.updatedAt, 100)
  const newer = mergeSettingItemsEntry({ key: playlistKey, value: { item: { value: { shuffleByDefault: false }, updatedAt: 200 } }, remoteEntry: older, now: 400 })
  assert.deepEqual(newer.value.item, { value: { shuffleByDefault: false }, updatedAt: 200 })
})

test('applying merged settings rejects instead of overwriting an edit made after the merge', async () => {
  const device = createPlaylistDevice([{ _id: 'playlist', shuffleByDefault: true, preferencesUpdatedAt: 10 }], { playlist: { remoteId: 'playlist' } })
  const merged = playlistPreferencesSync.getPlaylistPreferencesForSync(device.store.state.playlists.playlists, device.snapshot)
  Object.assign(device.store.state.playlists.playlists[0], { shuffleByDefault: false, preferencesUpdatedAt: 20 })
  device.store.dispatch = () => assert.fail('A newer local edit must not be overwritten')
  await assert.rejects(playlistPreferencesSync.applyPlaylistPreferencesSync(device.store,
    { playlist: { value: { shuffleByDefault: true }, updatedAt: 10 } }, device.snapshot, merged), /changed during sync/)

  const store = createStore([{ id: 'channel', dailyVideoLimit: 2, subscriptionSettingsUpdatedAt: 10 }])
  const mergedChannels = subscriptionSync.getSubscriptionSettingsForSync(store)
  Object.assign(store.state.profiles.profileList[0].subscriptions[0], { dailyVideoLimit: 4, subscriptionSettingsUpdatedAt: 20 })
  store.dispatch = () => assert.fail('A newer local edit must not be overwritten')
  await assert.rejects(subscriptionSync.applySubscriptionSettingsSync(store,
    { channel: { value: { dailyVideoLimit: 2 }, updatedAt: 10 } }, mergedChannels), /changed during sync/)
})

test('a newer local edit back to the synced value beats an older remote edit', () => {
  const merged = mergeSettingItemsEntry({
    key: playlistKey,
    value: { item: { value: { shuffleByDefault: false }, updatedAt: 30 } },
    old: { key: playlistKey, value: { item: { value: { shuffleByDefault: false }, updatedAt: 10 } }, updatedAt: 10 },
    remoteEntry: { key: playlistKey, value: { item: { value: { shuffleByDefault: true }, updatedAt: 20 } }, updatedAt: 20 },
    now: 40,
  })
  assert.deepEqual(merged.value.item, { value: { shuffleByDefault: false }, updatedAt: 30 })
})
