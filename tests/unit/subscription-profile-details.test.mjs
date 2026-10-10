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

async function profileStore() {
  const db = { profiles: new Datastore({ inMemoryOnly: true }) }
  const profiles = ['allChannels', 'custom'].map(_id => ({
    _id,
    name: _id,
    subscriptions: [{ id: 'channel', name: 'Old name', thumbnail: '', showMembersOnly: true }]
  }))
  await db.profiles.insertAsync(profiles)
  const DBProfileHandlers = vm.runInNewContext(
    handlersSource.slice(handlersSource.indexOf('class Profiles {'), handlersSource.indexOf('class Playlists {')) + '\nProfiles',
    { db, loadProfilesDatastore: async () => {}, copySubscriptionChannelSettings, getProfileWithUpdatedSubscriptionDetails }
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
    handlers.updateSubscriptionDetails = async channels => {
      const profileIds = await DBProfileHandlers.updateSubscriptionDetails(channels)
      broadcast('updateSubscriptionDetails', { channels, profileIds })
      return profileIds
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

test('subscription writes fail after bounded contention instead of retrying indefinitely', async () => {
  const { db, DBProfileHandlers } = await profileStore()
  let attempts = 0
  db.profiles.updateAsync = async () => {
    attempts++
    // Prevent the old implementation from hanging the regression run.
    if (attempts > 10) throw new Error('Test stopped an unbounded retry')
    return { numAffected: 0 }
  }

  await assert.rejects(DBProfileHandlers.updateSubscriptionDetails([
    { channelId: 'channel', channelName: 'New name' }
  ]), /Unable to update subscriptions.*concurrent changes/)
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
