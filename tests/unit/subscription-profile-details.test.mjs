import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'

import { getProfileWithUpdatedSubscriptionDetails } from '../../src/renderer/helpers/subscription-profile-details.js'
import { DEFAULT_PROFILE_ICON } from '../../src/renderer/helpers/profileIcons.js'
import { copySubscriptionChannelSettings } from '../../src/renderer/helpers/subscription-channels.js'

const profileSource = await readFile(new URL('../../src/renderer/store/modules/profiles.js', import.meta.url), 'utf8')
const handlersSource = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')

async function profileStore(subscriptions = [{ id: 'channel', name: 'Old name', thumbnail: '', showMembersOnly: true }]) {
  const db = { profiles: new Datastore({ inMemoryOnly: true }) }
  const profiles = ['allChannels', 'custom'].map(_id => ({
    _id,
    name: _id,
    subscriptions
  }))
  await db.profiles.insertAsync(profiles)
  const DBProfileHandlers = vm.runInNewContext(
    handlersSource.slice(handlersSource.indexOf('class Profiles {'), handlersSource.indexOf('class Playlists {')) + '\nProfiles',
    { db, loadProfilesDatastore: async () => {}, copySubscriptionChannelSettings, getProfileWithUpdatedSubscriptionDetails, console }
  )
  const stores = []
  function createStore() {
    const handlers = Object.create(DBProfileHandlers)
    const broadcast = (mutation, payload) => {
      for (const other of stores) {
        if (other !== store) other.commit(mutation, structuredClone(payload))
      }
    }
    handlers.upsert = async profile => {
      const result = await DBProfileHandlers.upsert(profile)
      broadcast('upsertProfileToList', profile)
      return result
    }
    handlers.updateChannelSettings = async (channel, requestedProfileIds) => {
      const profileIds = await DBProfileHandlers.updateChannelSettings(channel, requestedProfileIds)
      broadcast('updateChannelSettings', { channel, profileIds })
      return profileIds
    }
    handlers.batchUpdateChannelSettings = async (channels, requestedProfileIds) => {
      const profileIds = await DBProfileHandlers.batchUpdateChannelSettings(channels, requestedProfileIds)
      broadcast('updateChannelSettings', { channels, profileIds })
      return profileIds
    }
    handlers.updateSubscriptionDetails = async channels => {
      const result = await DBProfileHandlers.updateSubscriptionDetails(channels)
      const { profileIds } = result
      broadcast('updateSubscriptionDetails', { channels, profileIds })
      return result
    }
    const context = vm.createContext({
      MAIN_PROFILE_ID: 'allChannels', THEME_BG_COLOR: '#000000', THEME_TEXT_COLOR: '#ffffff',
      DEFAULT_PROFILE_ICON, DBProfileHandlers: handlers, getProfileWithUpdatedSubscriptionDetails, copySubscriptionChannelSettings,
      deepCopy: value => JSON.parse(JSON.stringify(value)), console
    })
    vm.runInContext(profileSource
      .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
      .replace('export default {', 'globalThis.profileModule = {'), context)
    const module = context.profileModule
    module.state.profileList = structuredClone(profiles)
    const store = {
      state: module.state,
      commit: (mutation, payload) => module.mutations[mutation](module.state, payload),
      dispatch: (action, payload) => module.actions[action](store, payload)
    }
    stores.push(store)
    return store
  }
  return { db, store: createStore(), createStore, DBProfileHandlers }
}

test('subscription writes fail after bounded contention instead of retrying indefinitely', async t => {
  const { db, DBProfileHandlers } = await profileStore()
  const errors = t.mock.method(console, 'error', () => {})
  let attempts = 0
  db.profiles.updateAsync = async () => {
    attempts++
    // Prevent the old implementation from hanging the regression run.
    if (attempts > 10) throw new Error('Test stopped an unbounded retry')
    return { numAffected: 0 }
  }

  const result = await DBProfileHandlers.updateSubscriptionDetails([
    { channelId: 'channel', channelName: 'New name' }
  ])
  assert.equal(result.success, false)
  assert.equal(result.profileIds.length, 0)
  assert.match(errors.mock.calls[0].arguments[0].message, /Unable to update subscriptions.*concurrent changes/)
  assert.equal(attempts, 5)
})

for (const action of ['updateSubscriptionDetails', 'batchUpdateSubscriptionDetails']) {
  test(`${action} reports failed persistence without changing renderer metadata`, async t => {
    const { db, store } = await profileStore()
    t.mock.method(console, 'error', () => {})
    db.profiles.updateAsync = async () => { throw new Error('Save failed') }
    const channel = { channelId: 'channel', channelName: 'New name' }
    assert.equal(await store.dispatch(action, action === 'batchUpdateSubscriptionDetails' ? [channel] : channel), false)
    for (const profile of store.state.profileList) {
      assert.equal(profile.subscriptions[0].name, 'Old name')
    }
  })
}

test('metadata saves report success for changed, unchanged, and empty updates', async () => {
  const { store } = await profileStore()
  assert.equal(await store.dispatch('batchUpdateSubscriptionDetails', []), true)
  const channel = { channelId: 'channel', channelName: 'New name' }
  assert.equal(await store.dispatch('updateSubscriptionDetails', channel), true)
  assert.equal(await store.dispatch('batchUpdateSubscriptionDetails', [channel]), true)
})

test('bulk disables 939 subscriptions with one write per profile and synchronizes other windows', async t => {
  const subscriptions = Array.from({ length: 939 }, (_, index) => ({
    id: `channel-${index}`, name: `Channel ${index}`, thumbnail: '', showMembersOnly: true,
    feedTypes: index % 2 ? ['videos'] : ['shorts', 'live'], dailyVideoLimit: index % 3 + 1
  }))
  const { db, store, createStore } = await profileStore(subscriptions)
  const other = createStore()
  const write = t.mock.method(db.profiles, 'updateAsync')
  assert.equal(await store.dispatch('batchUpdateChannelSettings', subscriptions.map(channel => ({
    channelId: channel.id, settings: { showMembersOnly: false }
  }))), true)
  assert.equal(write.mock.callCount(), 2)
  for (const profiles of [store.state.profileList, other.state.profileList, await db.profiles.findAsync({})]) {
    for (const profile of profiles) {
      assert.equal(profile.subscriptions.length, 939)
      for (const [index, channel] of profile.subscriptions.entries()) {
        assert.equal(channel.showMembersOnly, false)
        assert.equal(channel.name, subscriptions[index].name)
        assert.deepEqual([...channel.feedTypes], subscriptions[index].feedTypes)
        assert.equal(channel.dailyVideoLimit, subscriptions[index].dailyVideoLimit)
        assert.ok(channel.subscriptionSettingsUpdatedAt > 0)
      }
    }
  }
  assert.equal(await store.dispatch('batchUpdateChannelSettings', []), true)
  assert.equal(await store.dispatch('batchUpdateChannelSettings', [{ channelId: 'missing', settings: {} }]), false)
  assert.equal(write.mock.callCount(), 2)
})

for (const action of ['updateSubscriptionDetails', 'batchUpdateSubscriptionDetails', 'updateChannelSettings', 'batchUpdateChannelSettings']) {
  for (const failure of ['write error', 'retry exhaustion']) {
    test(`${action} synchronizes saved profiles after a later ${failure}`, async t => {
      const { db, store, createStore } = await profileStore()
      const other = createStore()
      t.mock.method(console, 'error', () => {})
      const update = db.profiles.updateAsync.bind(db.profiles)
      let savedProfileId
      db.profiles.updateAsync = async (...args) => {
        if (savedProfileId === undefined) {
          const result = await update(...args)
          savedProfileId = args[0]._id
          return result
        }
        if (failure === 'write error') throw new Error('Later profile write failed')
        return { numAffected: 0 }
      }

      const channel = { channelId: 'channel', channelName: 'New name' }
      const settingsUpdate = { channelId: 'channel', settings: { showMembersOnly: false } }
      assert.equal(await store.dispatch(action, action === 'batchUpdateChannelSettings'
        ? [settingsUpdate]
        : action === 'updateChannelSettings'
          ? settingsUpdate
        : action === 'batchUpdateSubscriptionDetails' ? [channel] : channel), false)
      assert.ok(savedProfileId)
      for (const profiles of [store.state.profileList, other.state.profileList, await db.profiles.findAsync({})]) {
        for (const profile of profiles) {
          const saved = profile._id === savedProfileId
          if (action === 'updateChannelSettings' || action === 'batchUpdateChannelSettings') {
            assert.equal(profile.subscriptions[0].showMembersOnly, !saved)
          } else {
            assert.equal(profile.subscriptions[0].name, saved ? 'New name' : 'Old name')
          }
        }
      }
    })
  }
}

for (const settingsFirst of [true, false]) {
  test(`a metadata refresh in another window preserves a members-only disable with settings first: ${settingsFirst}`, async () => {
    const { db, store, createStore } = await profileStore()
    const other = createStore()
    const disable = () => store.dispatch('updateChannelSettings', { channelId: 'channel', settings: { showMembersOnly: false } })
    const refresh = () => other.dispatch('batchUpdateSubscriptionDetails', [{ channelId: 'channel', channelName: 'New name' }])
    await Promise.all(settingsFirst ? [disable(), refresh()] : [refresh(), disable()])

    for (const profiles of [store.state.profileList, other.state.profileList, await db.profiles.findAsync({})]) {
      for (const profile of profiles) {
        assert.equal(profile.subscriptions[0].showMembersOnly, false)
        assert.equal(profile.subscriptions[0].name, 'New name')
      }
    }
  })
}

for (const action of ['updateSubscriptionDetails', 'batchUpdateSubscriptionDetails']) {
  for (const settingsFirst of [true, false]) {
    test(`${action} preserves a concurrent members-only disable with settings first: ${settingsFirst}`, async () => {
      const { db, store } = await profileStore()
      const update = { channelId: 'channel', channelName: 'New name', channelThumbnailUrl: 'https://yt3.googleusercontent.com/avatar=s88' }
      const disable = () => store.dispatch('updateChannelSettings', { channelId: 'channel', settings: { showMembersOnly: false } })
      const refresh = () => store.dispatch(action, action === 'batchUpdateSubscriptionDetails' ? [update] : update)
      await Promise.all(settingsFirst ? [disable(), refresh()] : [refresh(), disable()])

      for (const profiles of [store.state.profileList, await db.profiles.findAsync({})]) {
        for (const profile of profiles) {
          assert.equal(profile.subscriptions[0].showMembersOnly, false)
          assert.equal(profile.subscriptions[0].name, 'New name')
          assert.equal(profile.subscriptions[0].thumbnail, 'https://yt3.googleusercontent.com/avatar=s176')
        }
      }
    })
  }
}

for (const action of ['updateSubscriptionDetails', 'updateChannelSettings']) {
  test(`${action} does not restore a subscription removed during the save`, async () => {
    const { db, store } = await profileStore()
    const update = db.profiles.updateAsync.bind(db.profiles)
    let removed = false
    db.profiles.updateAsync = async (...args) => {
      if (!removed && args[0].subscriptions) {
        removed = true
        await update({}, { $pull: { subscriptions: { id: 'channel' } } }, { multi: true })
      }
      return update(...args)
    }

    await store.dispatch(action, action === 'updateChannelSettings'
      ? { channelId: 'channel', settings: { showMembersOnly: false } }
      : { channelId: 'channel', channelName: 'New name' })
    assert.equal(removed, true)
    for (const profile of await db.profiles.findAsync({})) {
      assert.deepEqual(profile.subscriptions, [])
    }
  })
}

test('updates channel details without changing the source profile', () => {
  const profile = {
    _id: 'allChannels',
    subscriptions: [
      { id: 'first', name: 'Old name', thumbnail: 'old-thumbnail' },
      { id: 'second', name: 'Unchanged', thumbnail: '' }
    ]
  }
  const updated = getProfileWithUpdatedSubscriptionDetails(profile, [
    {
      channelId: 'first',
      channelName: 'New name',
      channelThumbnailUrl: 'https://invidious.example/ggpht/avatar=s88'
    }
  ])

  assert.deepEqual(updated, {
    _id: 'allChannels',
    subscriptions: [
      {
        id: 'first',
        name: 'New name',
        thumbnail: 'https://yt3.googleusercontent.com/avatar=s176'
      },
      { id: 'second', name: 'Unchanged', thumbnail: '' }
    ]
  })
  assert.equal(profile.subscriptions[0].name, 'Old name')
  assert.equal(profile.subscriptions[0].thumbnail, 'old-thumbnail')
})

test('preserves ordered duplicate updates and skips an unchanged profile', () => {
  const profile = {
    _id: 'allChannels',
    subscriptions: [{ id: 'channel', name: 'Original', thumbnail: '' }]
  }

  const updated = getProfileWithUpdatedSubscriptionDetails(profile, [
    { channelId: 'channel', channelName: 'First' },
    { channelId: 'channel', channelName: null, channelThumbnailUrl: '' },
    { channelId: 'channel', channelName: 'Final' }
  ])

  assert.equal(updated.subscriptions[0].name, 'Final')
  assert.equal(updated.subscriptions[0].thumbnail, '')
  assert.equal(getProfileWithUpdatedSubscriptionDetails(updated, [
    { channelId: 'channel', channelName: 'Final' }
  ]), null)
})

test('checks each profile subscription once for a large no-op refresh', () => {
  const channelCount = 933
  let idReads = 0
  const subscriptions = Array.from({ length: channelCount }, (_, index) => ({
    get id () {
      idReads++
      return `channel-${index}`
    },
    name: `Channel ${index}`,
    thumbnail: ''
  }))
  const channels = Array.from({ length: channelCount }, (_, index) => ({
    channelId: `channel-${index}`,
    channelName: `Channel ${index}`
  }))

  assert.equal(getProfileWithUpdatedSubscriptionDetails({ subscriptions }, channels), null)
  assert.equal(idReads, channelCount)
})
