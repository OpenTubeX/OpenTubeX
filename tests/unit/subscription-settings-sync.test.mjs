import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import * as subscriptionSync from '../../src/renderer/helpers/subscription-settings-sync.js'
import { mergeSettingEntry, resolveMergedThemeEntry } from '../../src/renderer/helpers/sync-settings-conflict.js'

const key = subscriptionSync.SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY
const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const context = vm.createContext({
  ...subscriptionSync,
  mergeSettingEntry,
  resolveMergedThemeEntry,
  CUSTOM_THEMES_SYNC_KEY: 'customThemes',
  normalizeCustomThemes: value => value,
  getSyncableSettingKeys: () => [],
  isSettingSyncEnabled: settings => !settings.syncServerSettingsExcluded.includes(key),
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
  const first = createStore([{ id: 'channel', name: 'Original', feedTypes: ['shorts'], dailyVideoLimit: 3, showMembersOnly: true }])
  const client = createClient()
  await context.syncSettings(client, first)
  assert.deepEqual(client.entries.find(entry => entry.key === key).value.channel.value, {
    feedTypes: ['shorts'], dailyVideoLimit: 3, showMembersOnly: true,
  })
  const second = createStore([{ id: 'channel', name: 'Local name', thumbnail: 'local-thumbnail' }])
  await context.syncSettings(client, second)
  for (const profile of second.state.profiles.profileList) {
    assert.deepEqual(profile.subscriptions[0], {
      id: 'channel', name: 'Local name', thumbnail: 'local-thumbnail',
      feedTypes: ['shorts'], dailyVideoLimit: 3, showMembersOnly: true,
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

test('a failed channel write cannot advance the saved edit timestamp', async () => {
  const profilesSource = await readFile(new URL('../../src/renderer/store/modules/profiles.js', import.meta.url), 'utf8')
  let timestamp = 100
  let failWrite = true
  let persistedChannel
  const persistenceContext = vm.createContext({
    MAIN_PROFILE_ID: 'allChannels', THEME_BG_COLOR: '#000000', THEME_TEXT_COLOR: '#ffffff',
    deepCopy: structuredClone,
    console: { error() {} },
    DBProfileHandlers: { async updateChannelSettings(channel, ids) {
      if (failWrite) throw new Error('Channel write failed')
      persistedChannel = structuredClone(channel)
      return ids
    } },
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
  for (const updatedAt of [undefined, null, '100', -1, NaN, Infinity]) {
    assert.equal(await module.actions.updateChannelSettings(actionContext, { channelId: 'channel', settings: { dailyVideoLimit: 4 }, fromSync: true, updatedAt }), false)
    assert.equal(persistedChannel.subscriptionSettingsUpdatedAt, 300)
    assert.equal(persistedChannel.dailyVideoLimit, 3)
    assert.equal(module.state.profileList[0].subscriptions[0].subscriptionSettingsUpdatedAt, 300)
  }
})

test('rejects invalid remote edit times before dispatching channel settings', async () => {
  for (const updatedAt of [undefined, null, '100', -1, NaN, Infinity]) {
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
