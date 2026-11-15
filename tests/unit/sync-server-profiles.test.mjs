import { DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { MAIN_PROFILE_ID } from '../../src/constants.js'
import { SyncServerDataLossError } from '../../src/renderer/helpers/sync-server-errors.js'
import * as profileSync from '../../src/renderer/helpers/profile-sync.js'
import * as profileSnapshots from '../../src/renderer/helpers/profileSyncSnapshot.js'

// Run the real sync code, replacing bundler imports with its profile dependencies.
const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const context = vm.createContext({ DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeSyncIds, syncVideoToRemote, MAIN_PROFILE_ID, SyncServerDataLossError, deepCopy: structuredClone, ...profileSync })
vm.runInContext(source
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export \{[\s\S]*?\}\n/gm, '')
  .replace(/^export (?=(async )?(function|class|const))/gm, '') + '\nglobalThis.syncProfiles = syncProfiles', context)

for (const colors of [
  { bg_color: '#123456', text_color: '#abcdef' },
  { bg_color: null, text_color: null },
]) {
  test(`first sync imports a remote profile with colors ${JSON.stringify(colors)}`, async () => {
    const channel = { id: 'channel-1', name: 'Subscribed channel' }
    const profileList = [{ _id: MAIN_PROFILE_ID, subscriptions: [channel] }]
    const group = { id: 'remote-profile', local_id: 'profile-1', title: 'Music', ...colors }
    const client = {
      getSubscriptionGroups: async () => [{ group, channels: [{ id: channel.id }] }],
    }
    const store = {
      state: { profiles: { profileList } },
      dispatch: async (action, { profile, previous }) => {
        assert.equal(action, 'saveSyncedProfile')
        assert.equal(previous, null)
        profileList.push(structuredClone(profile))
        return true
      },
    }

    const snapshot = await context.syncProfiles(client, store)

    assert.deepEqual(profileList[1], {
      _id: 'profile-1',
      name: 'Music',
      bgColor: colors.bg_color ?? '#000000',
      textColor: colors.text_color ?? '#FFFFFF',
      subscriptions: [channel],
    })
    assert.deepEqual(structuredClone(snapshot), {
      'profile-1': {
        remoteId: 'remote-profile',
        metadata: {
          title: 'Music',
          bgColor: colors.bg_color ?? '#000000',
          textColor: colors.text_color ?? '#FFFFFF',
        },
        channels: [channel.id],
      },
    })

    // A later sync uploads edits made on the second device to the same server group.
    profileList[1].name = 'Renamed on second device'
    const uploads = []
    client.updateSubscriptionGroup = async (id, payload) => uploads.push([id, structuredClone(payload)])
    await context.syncProfiles(client, store, snapshot)
    assert.deepEqual(uploads, [['remote-profile', {
      id: 'profile-1',
      local_id: 'profile-1',
      title: 'Renamed on second device',
      bg_color: colors.bg_color ?? '#000000',
      text_color: colors.text_color ?? '#FFFFFF',
    }]])
  })
}

for (const deletedFrom of ['server', 'device']) {
  test(`destructive profile sync identifies the profile deleted from the ${deletedFrom}`, async () => {
    const profile = { _id: 'profile-1', name: 'Music', subscriptions: [] }
    const store = {
      state: {
        profiles: {
          profileList: [
            { _id: MAIN_PROFILE_ID, subscriptions: [] },
            ...(deletedFrom === 'server' ? [profile] : []),
          ]
        }
      },
      dispatch: async () => assert.fail('Must not change local data before confirmation'),
    }
    const client = {
      getSubscriptionGroups: async () => deletedFrom === 'server'
        ? []
        : [{
            group: { id: 'remote-1', local_id: profile._id, title: profile.name }, channels: [],
          }],
    }
    await assert.rejects(context.syncProfiles(client, store, {
      'profile-1': { remoteId: 'remote-1', metadata: { title: 'Old name' }, channels: [] },
    }), error => {
      assert.ok(error instanceof SyncServerDataLossError)
      assert.equal(error.deleted, 1)
      assert.deepEqual(structuredClone(error.items), [{ id: 'profile-1', name: 'Music' }])
      return true
    })
  })
}

test('a synced profile channel this device is not subscribed to is not removed later', async () => {
  const channel = { id: 'channel-1', name: 'Subscribed channel' }
  // Subscriptions sync is off, so the main profile lacks the other device's channel.
  const profileList = [{ _id: MAIN_PROFILE_ID, subscriptions: [channel] }]
  const group = { id: 'remote-profile', local_id: 'profile-1', title: 'Music', bg_color: '#123456', text_color: '#abcdef' }
  const removed = []
  const client = {
    getSubscriptionGroups: async () => [{ group, channels: [{ id: channel.id }, { id: 'other-device-channel' }] }],
    removeSubscriptionGroupChannel: async (groupId, channelId) => removed.push(channelId),
  }
  const store = {
    state: { profiles: { profileList } },
    dispatch: async (action, { profile }) => {
      assert.equal(action, 'saveSyncedProfile')
      const index = profileList.findIndex(saved => saved._id === profile._id)
      profileList.splice(index === -1 ? profileList.length : index, 1, structuredClone(profile))
      return true
    },
  }

  const snapshot = await context.syncProfiles(client, store)
  assert.deepEqual(profileList[1].subscriptions, [channel])
  await context.syncProfiles(client, store, snapshot)

  assert.deepEqual(removed, [])
})

// Saves only while the stored profile still matches what the sync read, like the datastore does
function createConditionalStore(profileList) {
  const { profileSyncSnapshot } = profileSnapshots
  return {
    state: { profiles: { profileList } },
    dispatch: async (action, value) => {
      assert.equal(action, 'saveSyncedProfile')
      const { profile, previous } = value
      const index = profileList.findIndex(saved => saved._id === profile._id)
      const current = profileList[index]
      if (previous === null ? current !== undefined : current === undefined || profileSyncSnapshot(current) !== profileSyncSnapshot(previous)) {
        return false
      }
      profileList.splice(index === -1 ? profileList.length : index, index === -1 ? 0 : 1, structuredClone(profile))
      return true
    },
  }
}

for (const deletedKnown of [true, false]) {
  test(`a profile edited or deleted while the server responds keeps the edit and stays deleted${deletedKnown ? '' : ' on its first sync'}`, async () => {
    const [remoteChannel, localChannel, otherChannel] = ['remote-channel', 'local-channel', 'other-channel'].map(id => ({ id, name: id }))
    const metadata = { title: 'Music', bgColor: '#000000', textColor: '#FFFFFF' }
    const profileList = [
      { _id: MAIN_PROFILE_ID, subscriptions: [remoteChannel, localChannel, otherChannel] },
      { _id: 'edited', name: 'Music', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [] },
      { _id: 'deleted', name: 'Music', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [] },
    ]
    const previous = {
      edited: { remoteId: 'edited', metadata, channels: [] },
      ...(deletedKnown ? { deleted: { remoteId: 'deleted', metadata, channels: [] } } : {}),
    }
    const group = id => ({ id, local_id: id, title: 'Music', bg_color: '#000000', text_color: '#FFFFFF' })
    const remote = { edited: [remoteChannel.id], deleted: [otherChannel.id] }
    let editedMeanwhile = false
    const client = {
      getSubscriptionGroups: async () => Object.entries(remote).map(([id, channels]) => ({ group: group(id), channels: channels.map(channelId => ({ id: channelId })) })),
      addSubscriptionGroupChannel: async (id, channelId) => { remote[id].push(channelId) },
      removeSubscriptionGroupChannel: async (id, channelId) => { remote[id] = remote[id].filter(item => item !== channelId) },
      deleteSubscriptionGroup: async id => { delete remote[id] },
    }
    const store = createConditionalStore(profileList)
    const getSubscriptionGroups = client.getSubscriptionGroups
    client.getSubscriptionGroups = async () => {
      const groups = await getSubscriptionGroups()
      if (!editedMeanwhile) {
        editedMeanwhile = true
        // Another window adds a channel in place and deletes the other profile
        profileList[1].subscriptions.push(localChannel)
        profileList.splice(2, 1)
      }
      return groups
    }

    await context.syncProfiles(client, store, previous)

    assert.deepEqual(profileList.map(profile => profile._id), [MAIN_PROFILE_ID, 'edited'])
    assert.deepEqual(profileList[1].subscriptions.map(channel => channel.id).sort(), [localChannel.id, remoteChannel.id])
    assert.deepEqual(remote.edited.sort(), [localChannel.id, remoteChannel.id])
    assert.equal(remote.deleted, undefined)
  })
}

for (const keptBefore of [false, true]) {
  test(`the only profile deleted during its first sync stays deleted without asking${keptBefore ? ', even after keeping it before' : ''}`, async () => {
    const channel = { id: 'channel', name: 'Channel' }
    const profileList = [
      { _id: MAIN_PROFILE_ID, subscriptions: [channel] },
      { _id: 'deleted', name: 'Music', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [] },
    ]
    let remote = ['deleted']
    let deletedMeanwhile = false
    const client = {
      getSubscriptionGroups: async () => {
        const groups = remote.map(id => ({ group: { id, local_id: id, title: 'Music', bg_color: '#000000', text_color: '#FFFFFF' }, channels: [{ id: channel.id }] }))
        if (!deletedMeanwhile) {
          deletedMeanwhile = true
          // Another window deletes the profile while the server responds
          profileList.splice(1, 1)
        }
        return groups
      },
      deleteSubscriptionGroup: async id => { remote = remote.filter(item => item !== id) },
    }

    const deletions = keptBefore ? { profiles: { kept: ['deleted'] } } : undefined
    await context.syncProfiles(client, createConditionalStore(profileList), {}, { deletions })

    assert.deepEqual(profileList.map(profile => profile._id), [MAIN_PROFILE_ID])
    assert.deepEqual(remote, [])
  })
}

test('a retry keeps an edit made to a profile the failed attempt already saved', async () => {
  const [added, other] = ['added-elsewhere', 'other-channel'].map(id => ({ id, name: id }))
  const group = id => ({ id, local_id: id, title: id, bg_color: '#000000', text_color: '#FFFFFF' })
  const profileList = [
    { _id: MAIN_PROFILE_ID, subscriptions: [added, other] },
    { _id: 'first', name: 'first', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [] },
    { _id: 'second', name: 'second', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [] },
  ]
  const previous = Object.fromEntries(['first', 'second'].map(id => [id, { remoteId: id, metadata: { title: id, bgColor: '#000000', textColor: '#FFFFFF' }, channels: [] }]))
  // Another device added a channel to each profile
  const remote = { first: [added.id], second: [other.id] }
  const client = {
    getSubscriptionGroups: async () => Object.entries(remote).map(([id, channels]) => ({ group: group(id), channels: channels.map(channelId => ({ id: channelId })) })),
    addSubscriptionGroupChannel: async (id, channelId) => { remote[id].push(channelId) },
    removeSubscriptionGroupChannel: async (id, channelId) => { remote[id] = remote[id].filter(item => item !== channelId) },
    updateSubscriptionGroup: async () => {},
  }
  const store = createConditionalStore(profileList)
  const dispatch = store.dispatch
  let edited = false
  store.dispatch = async (action, value) => {
    const saved = await dispatch(action, value)
    if (saved && value.profile._id === 'first' && !edited) {
      edited = true
      // Another window removes the channel the sync just saved, and edits the second profile
      profileList[1] = { ...profileList[1], subscriptions: [] }
      profileList[2] = { ...profileList[2], name: 'second renamed' }
    }
    return saved
  }

  await context.syncProfiles(client, store, previous)

  assert.deepEqual(profileList[1].subscriptions, [])
  assert.deepEqual(remote.first, [])
  assert.equal(profileList[2].name, 'second renamed')
})
