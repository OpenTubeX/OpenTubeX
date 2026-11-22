import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addSyncDeletionMarks,
  createSyncDeletionDecisions,
  createUnsentSyncDeletionMarks,
  readSyncDeletionMarks,
  syncDeletionKey,
  trackLocalSyncDeletions,
  translateSyncDeletionMarks,
  withRemoteSyncDeletions,
} from '../../src/renderer/helpers/sync-deletions.js'
import { mergeIds } from '../../src/renderer/helpers/sync-history-merge.js'
import { SyncServerDataLossError } from '../../src/renderer/helpers/sync-server-errors.js'

const MAIN_PROFILE_ID = 'allChannels'

function createStore (state) {
  const subscribers = []
  return {
    state,
    subscribeAction: subscriber => subscribers.push(subscriber),
    async dispatch (type, run, { remote = false } = {}) {
      const action = { type }
      for (const subscriber of subscribers) {
        if (remote) remoteDepth++
        try { subscriber.before(action) } finally { if (remote) remoteDepth-- }
      }
      await run()
      for (const subscriber of subscribers) subscriber.after(action)
    },
  }
}
let remoteDepth = 0

function trackedStore (state, dataScope = () => null) {
  const decisions = createSyncDeletionDecisions()
  const store = createStore({ settings: { syncServerEnabled: true, syncServerToken: 'token' }, ...state })
  trackLocalSyncDeletions({ isRemoteDispatch: () => remoteDepth > 0, mainProfileId: MAIN_PROFILE_ID, dataScope, decisions })(store)
  return { store, decisions }
}

test('removing the last items locally does not ask for confirmation', async () => {
  const ids = ['a', 'b', 'c']
  const { store, decisions } = trackedStore({ history: { historyCacheSorted: ids.map(videoId => ({ videoId })) } })
  assert.throws(() => mergeIds([], ids, ids, { collection: 'history' }), SyncServerDataLossError)

  await store.dispatch('removeAllHistory', () => { store.state.history.historyCacheSorted = [] })
  assert.deepEqual(Array.from(mergeIds([], ids, ids, { collection: 'history', deletions: decisions.snapshot() })), [])
})

test('emptying a list of fewer than three items is an ordinary edit', () => {
  // Another device unsubscribed from the only two channels.
  assert.deepEqual(Array.from(mergeIds(['a', 'b'], [], ['a', 'b'], { collection: 'subscriptions' })), [])
})

test('decisions survive a restart and are shared by every window', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  createSyncDeletionDecisions(storage).confirm('history', ['a'])
  const otherWindow = createSyncDeletionDecisions(storage)
  const used = otherWindow.snapshot()
  assert.deepEqual(used, { history: { confirmed: ['a'], kept: [] } })
  otherWindow.release(used)
  assert.deepEqual(createSyncDeletionDecisions(storage).snapshot(), {})
  assert.equal(values.size, 0)
})

test('decisions and unsent marks stay in memory when the storage is full, without dropping other windows\' changes', () => {
  const values = new Map()
  let full = true
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      if (full) throw new Error('QuotaExceededError')
      values.set(key, value)
    },
    removeItem: key => values.delete(key),
  }
  const decisions = createSyncDeletionDecisions(storage)
  decisions.confirm('history', ['a'])
  assert.deepEqual(decisions.snapshot(), { history: { confirmed: ['a'], kept: [] } })
  const unsent = createUnsentSyncDeletionMarks(storage)
  unsent.add('account', decisions.snapshot(), () => true)
  assert.deepEqual(unsent.read('account').map(mark => mark.ids), [['a']])

  // Space frees up, and another window saves its own changes.
  full = false
  createSyncDeletionDecisions(storage).keep('subscriptions', ['b'])
  createUnsentSyncDeletionMarks(storage).add('account', { subscriptions: { confirmed: ['c'] } }, () => true)
  decisions.release({ history: { confirmed: ['a'], kept: [] } })
  assert.deepEqual(createSyncDeletionDecisions(storage).snapshot(), { subscriptions: { confirmed: [], kept: ['b'] } })
  unsent.remove('account', unsent.read('account').filter(mark => mark.key === 'history'))
  assert.deepEqual(createUnsentSyncDeletionMarks(storage).read('account').map(mark => [mark.key, ...mark.ids]), [['subscriptions', 'c']])
})

test('unsent deletion marks belong to the account that made them', () => {
  const unsent = createUnsentSyncDeletionMarks()
  unsent.add('first', { subscriptions: { confirmed: ['a'] } }, () => true)
  assert.equal(unsent.read('second').length, 0)
  unsent.add('second', { subscriptions: { confirmed: ['b'] } }, () => true)
  assert.deepEqual(unsent.read('second').map(mark => mark.ids), [['b']])
  assert.equal(unsent.read('first').length, 0)
})

test('another device\'s deletions apply without asking only to items the server lost', () => {
  const previous = ['a', 'b', 'c', 'd']
  const marks = readSyncDeletionMarks([{ key: 'subscriptions', at: Date.now(), ids: previous }])
  const deletions = withRemoteSyncDeletions({}, marks)
  // `d` was added back after the deletion, so this device keeps it.
  assert.deepEqual(Array.from(mergeIds(previous, ['d'], previous, { collection: 'subscriptions', deletions })), ['d'])
  // A local deletion is this device's own, which the marks do not confirm.
  assert.throws(() => mergeIds([], previous, previous, { collection: 'subscriptions', deletions }), SyncServerDataLossError)
  // A playlist restored after another device removed it keeps its videos.
  const videos = withRemoteSyncDeletions({}, [{ key: syncDeletionKey('playlistVideos', 'list'), at: Date.now(), ids: previous }])
  assert.deepEqual(Array.from(mergeIds(previous, [], previous, {
    collection: 'playlistVideos', scope: 'list', restored: true, deletions: videos,
  })), previous)
})

test('shared deletion marks name playlists and profiles by the IDs every device knows', () => {
  // A legacy sync server assigned server IDs, which each device maps to its own.
  const deleting = { playlists: { a1: { remoteId: 'p1' } }, profiles: { a2: { remoteId: 'g1' } } }
  const receiving = { playlists: { b1: { remoteId: 'p1' } }, profiles: { b2: { remoteId: 'g1' } } }
  const marks = [
    { key: 'playlists', at: 1, ids: ['a1', 'new'] },
    { key: syncDeletionKey('playlistVideos', 'a1'), at: 1, ids: ['video'] },
    { key: 'profiles', at: 1, ids: ['a2'] },
    { key: syncDeletionKey('profileChannels', 'a2'), at: 1, ids: ['channel'] },
    { key: 'subscriptions', at: 1, ids: ['a1'] },
  ]
  const shared = translateSyncDeletionMarks(marks, deleting, true)
  assert.deepEqual(shared.map(({ key, ids }) => [key, ...ids]), [
    ['playlists', 'p1', 'new'],
    ['playlistVideos:p1', 'video'],
    ['profiles', 'g1'],
    ['profileChannels:g1', 'channel'],
    ['subscriptions', 'a1'],
  ])
  assert.deepEqual(translateSyncDeletionMarks(shared, receiving, false).map(({ key, ids }) => [key, ...ids]), [
    ['playlists', 'b1', 'new'],
    ['playlistVideos:b1', 'video'],
    ['profiles', 'b2'],
    ['profileChannels:b2', 'channel'],
    ['subscriptions', 'a1'],
  ])
})

test('shared deletion marks expire, and new ones replace older marks of the same items', () => {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const marks = readSyncDeletionMarks([
    { key: 'history', at: now - 31 * day, ids: ['expired'] },
    { key: 'history', at: now - day, ids: ['a', 'b'] },
    { key: 'history', at: now, ids: [1] },
  ], now)
  assert.deepEqual(marks, [{ key: 'history', at: now - day, ids: ['a', 'b'] }])

  const decisions = { history: { confirmed: ['b'] }, subscriptions: { confirmed: ['c'] }, playlists: { kept: ['d'] } }
  assert.deepEqual(addSyncDeletionMarks(marks, decisions, { now, includeKey: key => key !== 'subscriptions' }), [
    { key: 'history', at: now - day, ids: ['a'] },
    { key: 'history', at: now, ids: ['b'] },
  ])
  assert.equal(addSyncDeletionMarks(marks, { playlists: { kept: ['d'] } }, { now }), null)
})

test('local deletions are confirmed only for the list they changed', async () => {
  const { store, decisions } = trackedStore({
    playlists: {
      playlists: [
        { _id: 'later', videos: [{ videoId: 'a' }, { videoId: 'b' }] },
        { _id: 'old', videos: [{ videoId: 'c' }] },
      ],
    },
  })
  await store.dispatch('removeVideo', () => {
    store.state.playlists.playlists[0] = { _id: 'later', videos: [{ videoId: 'b' }] }
  })
  await store.dispatch('removePlaylist', () => {
    store.state.playlists.playlists = store.state.playlists.playlists.slice(0, 1)
  })
  const snapshot = decisions.snapshot()
  assert.deepEqual(snapshot[syncDeletionKey('playlistVideos', 'later')].confirmed, ['a'])
  assert.deepEqual(snapshot.playlists.confirmed, ['old'])
})

test('deletions applied by sync are not confirmed as user deletions', async () => {
  const { store, decisions } = trackedStore({
    profiles: { profileList: [{ _id: MAIN_PROFILE_ID, subscriptions: [{ id: 'channel' }] }] },
  })
  await store.dispatch('updateProfile', () => {
    store.state.profiles.profileList = [{ _id: MAIN_PROFILE_ID, subscriptions: [] }]
  }, { remote: true })
  assert.deepEqual(decisions.snapshot(), {})

  store.state.profiles.profileList = [{ _id: MAIN_PROFILE_ID, subscriptions: [{ id: 'channel' }] }]
  await store.dispatch('removeChannelFromProfiles', () => {
    store.state.profiles.profileList = [{ _id: MAIN_PROFILE_ID, subscriptions: [] }]
  })
  assert.deepEqual(decisions.snapshot().subscriptions.confirmed, ['channel'])
})

test('a successful sync forgets only the decisions it used', () => {
  const decisions = createSyncDeletionDecisions()
  decisions.confirm('history', ['a'])
  const used = decisions.snapshot()
  decisions.confirm('history', ['b'])
  decisions.keep('subscriptions', ['c'])
  decisions.release(used)
  assert.deepEqual(decisions.snapshot(), {
    history: { confirmed: ['b'], kept: [] },
    subscriptions: { confirmed: [], kept: ['c'] },
  })
  // The latest choice for an item wins.
  decisions.confirm('subscriptions', ['c'])
  assert.deepEqual(decisions.snapshot().subscriptions, { confirmed: ['c'], kept: [] })
})

test('kept deletions restore the items on the side that lost them', () => {
  const previous = ['a', 'b', 'c']
  const deletions = { subscriptions: { kept: previous } }
  assert.deepEqual(Array.from(mergeIds(previous, [], previous, { collection: 'subscriptions', deletions })), previous)
  assert.deepEqual(Array.from(mergeIds([], previous, previous, { collection: 'subscriptions', deletions })), previous)
  // Decisions belong to one list.
  assert.throws(() => mergeIds(previous, [], previous, { collection: 'history', deletions }), SyncServerDataLossError)
})

test('a partial confirmation still asks about the remaining deletions', () => {
  const ids = ['a', 'b', 'c', 'd']
  assert.throws(() => mergeIds([], ids, ids, {
    collection: 'history',
    deletions: { history: { confirmed: ['a'] } },
  }), error => {
    assert.equal(error.deleted, 3)
    assert.deepEqual(error.items, ['b', 'c', 'd'].map(id => ({ id, name: id })))
    return true
  })
})

test('emptying a list inside a synced playlist or profile is an ordinary edit', () => {
  for (const collection of ['playlistVideos', 'profileChannels']) {
    assert.deepEqual(Array.from(mergeIds([], ['only'], ['only'], { collection, scope: 'parent' })), [])
    assert.deepEqual(Array.from(mergeIds(['only'], [], ['only'], { collection, scope: 'parent' })), [])
    // Removing most of a long list still asks.
    const many = Array.from({ length: 10 }, (_, index) => `item-${index}`)
    assert.throws(() => mergeIds(many, [], many, { collection, scope: 'parent', scopeName: 'Watch later' }), error => {
      assert.equal(error.scope, 'parent')
      assert.equal(error.scopeName, 'Watch later')
      assert.match(error.message, /Watch later/)
      return true
    })
  }
})

test('items already missing on both sides do not count as deletions', () => {
  const previous = Array.from({ length: 20 }, (_, index) => `item-${index}`)
  const remaining = previous.slice(10)
  assert.deepEqual(Array.from(mergeIds(remaining, remaining, previous)), remaining)
})

test('deletions are not tracked while sync is off', async () => {
  const { store, decisions } = trackedStore({
    settings: { syncServerEnabled: false, syncServerToken: '' },
    history: { historyCacheSorted: [{ videoId: 'only' }] },
  })
  await store.dispatch('removeFromHistory', () => { store.state.history.historyCacheSorted = [] })
  assert.deepEqual(decisions.snapshot(), {})
})

test('deletions in a separate profile are kept apart from the shared ones', async () => {
  const separate = { _id: 'separate', separate: true, subscriptions: [{ id: 'channel' }] }
  const { store, decisions } = trackedStore({
    history: { historyCacheSorted: [{ videoId: 'video' }] },
    profiles: { activeProfile: 'separate', profileList: [{ _id: MAIN_PROFILE_ID, subscriptions: [] }, separate] },
  }, () => 'separate')
  await store.dispatch('removeFromHistory', () => { store.state.history.historyCacheSorted = [] })
  await store.dispatch('removeChannelFromProfiles', () => {
    store.state.profiles.profileList[1] = { ...separate, subscriptions: [] }
  })
  assert.deepEqual(decisions.snapshot('separate'), {
    history: { confirmed: ['video'], kept: [] },
    subscriptions: { confirmed: ['channel'], kept: [] },
  })
  assert.deepEqual(decisions.snapshot(), {})

  await store.dispatch('removeProfile', () => { store.state.profiles.profileList.splice(1, 1) })
  assert.deepEqual(decisions.snapshot().separateProfiles.confirmed, ['separate'])
  assert.equal(decisions.snapshot().profiles, undefined)
  decisions.release(decisions.snapshot('separate'), 'separate')
  assert.deepEqual(decisions.snapshot('separate'), {})
})

test('a deletion that finishes after a profile switch confirms nothing in either profile', async () => {
  let scope = null
  const { store, decisions } = trackedStore({
    history: { historyCacheSorted: ['a', 'b', 'c'].map(videoId => ({ videoId })) },
  }, () => scope)
  await store.dispatch('removeFromHistory', () => {
    // The switch loads the other profile's history while the removal runs.
    scope = undefined
    store.state.history.historyCacheSorted = [{ videoId: 'other' }]
    scope = 'separate'
  })
  assert.deepEqual(decisions.snapshot(), {})
  assert.deepEqual(decisions.snapshot('separate'), {})
})

test('deleting the active separate profile confirms its deletion although the app switches away from it', async () => {
  let scope = 'separate'
  const { store, decisions } = trackedStore({
    profiles: { activeProfile: 'separate', profileList: [{ _id: MAIN_PROFILE_ID, subscriptions: [] }, { _id: 'separate', separate: true, subscriptions: [] }] },
  }, () => scope)
  await store.dispatch('removeProfile', () => {
    // The removal selects All Channels, whose data then loads.
    store.state.profiles.profileList.splice(1, 1)
    scope = undefined
  })
  assert.deepEqual(decisions.snapshot().separateProfiles.confirmed, ['separate'])
})
