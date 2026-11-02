import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { toRaw } from 'vue'

import { MAIN_PROFILE_ID } from '../../src/constants.js'
import { DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import * as errors from '../../src/renderer/helpers/sync-server-errors.js'
import * as profileSync from '../../src/renderer/helpers/profile-sync.js'

const withoutImports = source => source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
const syncSource = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const profilesSource = await readFile(new URL('../../src/renderer/store/modules/profiles.js', import.meta.url), 'utf8')
const handlersSource = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')

const sync = vm.createContext({ DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeSyncIds, syncVideoToRemote, toRaw, MAIN_PROFILE_ID, deepCopy: structuredClone, ...errors, ...profileSync })
vm.runInContext(withoutImports(syncSource)
  .replace(/^export \{[\s\S]*?\}\n/gm, '')
  .replace(/^export (?=(async )?(function|class|const))/gm, ''), sync)

const channel = id => ({ id, name: `Channel ${id}`, thumbnail: `https://yt3.googleusercontent.com/${id}` })

// Runs the real profile store module on the real profile datastore handlers.
async function fixture(subscriptions) {
  const db = { profiles: new Datastore({ inMemoryOnly: true }) }
  await db.profiles.insertAsync([
    { _id: MAIN_PROFILE_ID, name: 'All Channels', subscriptions },
    { _id: 'second', name: 'Second', subscriptions: [] },
  ])
  const globals = { MAIN_PROFILE_ID, THEME_BG_COLOR: '#000000', THEME_TEXT_COLOR: '#ffffff', DEFAULT_PROFILE_ICON: { type: 'icon' }, console }
  const DBProfileHandlers = vm.runInNewContext(
    handlersSource.slice(handlersSource.indexOf('class Profiles {'), handlersSource.indexOf('class Playlists {')) + '\nProfiles',
    { ...globals, db, loadProfilesDatastore: async () => {} }
  )
  const context = vm.createContext({ ...globals, DBProfileHandlers })
  vm.runInContext(withoutImports(profilesSource).replace('export default {', 'globalThis.profileModule = {'), context)
  const { state, actions, mutations } = context.profileModule
  const commit = (type, payload) => mutations[type](state, payload)
  const store = {
    state: { profiles: state, settings: {} },
    commit,
    dispatch: (type, payload) => actions[type]({ state, commit, dispatch: store.dispatch, rootState: store.state }, payload),
  }
  await store.dispatch('grabAllProfiles')

  const remote = new Map()
  const client = {
    getSubscriptions: async () => [...remote.values()],
    supportsBulkSync: async () => true,
    subscribeBulk: async channels => channels.forEach(channel => remote.set(channel.id, channel)),
    unsubscribe: async id => remote.delete(id),
  }
  const ids = async () => structuredClone((await db.profiles.findOneAsync({ _id: MAIN_PROFILE_ID })).subscriptions.map(channel => channel.id))
  return { db, store, client, remote, ids, mainIds: () => structuredClone(state.profileList[0].subscriptions.map(channel => channel.id)) }
}

for (const remoteIds of [[], ['C']]) {
  test(`subscription sync keeps a subscription made in this window while the server responds with ${JSON.stringify(remoteIds)}`, async () => {
    const { store, client, remote, ids, mainIds } = await fixture([channel('A')])
    for (const id of remoteIds) remote.set(id, { id, name: `Channel ${id}`, avatar: DEFAULT_CHANNEL_AVATAR, verified: false })
    const getSubscriptions = client.getSubscriptions
    let subscribed = false
    client.getSubscriptions = async () => {
      if (!subscribed) {
        subscribed = true
        await store.dispatch('addChannelToProfiles', { channel: channel('B'), profileIds: [MAIN_PROFILE_ID, 'second'] })
      }
      return getSubscriptions()
    }

    const synced = await sync.syncSubscriptions(client, store, [])

    // Without a remote change nothing is saved; the next sync uploads B.
    const expected = remoteIds.length === 0 ? ['A'] : ['A', 'B', 'C']
    assert.deepEqual([...synced].sort(), expected)
    assert.deepEqual([...remote.keys()].sort(), expected)
    assert.deepEqual(mainIds().sort(), ['A', 'B', ...remoteIds])
    assert.deepEqual(await ids(), mainIds())
    assert.deepEqual(structuredClone(store.state.profiles.profileList[1].subscriptions.map(channel => channel.id)), ['B'])
  })
}

test('subscription sync does not overwrite a subscription another window saved first', async () => {
  const { db, store, client, remote, ids, mainIds } = await fixture([channel('A')])
  remote.set('C', { id: 'C', name: 'Channel C', avatar: DEFAULT_CHANNEL_AVATAR, verified: false })
  const getSubscriptions = client.getSubscriptions
  let calls = 0
  client.getSubscriptions = async () => {
    // Another window's change reaches this window's store before the retry.
    if (++calls === 2) store.commit('addChannelToProfiles', { channel: channel('B'), profileIds: [MAIN_PROFILE_ID] })
    return getSubscriptions()
  }
  const subscribeBulk = client.subscribeBulk
  client.subscribeBulk = async channels => {
    if (calls === 1) await db.profiles.updateAsync({ _id: MAIN_PROFILE_ID }, { $push: { subscriptions: channel('B') } })
    return subscribeBulk(channels)
  }

  await sync.syncSubscriptions(client, store, [])

  assert.deepEqual((await ids()).sort(), ['A', 'B', 'C'])
  assert.deepEqual(mainIds().sort(), ['A', 'B', 'C'])
  assert.deepEqual([...remote.keys()].sort(), ['A', 'B', 'C'])
})

test('subscription sync gives up after repeated concurrent changes', async () => {
  const { store, client, remote } = await fixture([channel('A')])
  remote.set('C', { id: 'C', name: 'Channel C', avatar: DEFAULT_CHANNEL_AVATAR, verified: false })
  const getSubscriptions = client.getSubscriptions
  let calls = 0
  client.getSubscriptions = async () => {
    await store.dispatch('addChannelToProfiles', { channel: channel(`new-${++calls}`), profileIds: [MAIN_PROFILE_ID] })
    return getSubscriptions()
  }

  await assert.rejects(sync.syncSubscriptions(client, store, []), /Subscriptions changed during sync/)
  assert.equal(calls, 3)
})
