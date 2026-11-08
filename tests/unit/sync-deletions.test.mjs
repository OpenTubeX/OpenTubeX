import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSyncDeletionDecisions,
  syncDeletionKey,
  trackLocalSyncDeletions,
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

function trackedStore (state) {
  const decisions = createSyncDeletionDecisions()
  const store = createStore(state)
  trackLocalSyncDeletions({ isRemoteDispatch: () => remoteDepth > 0, mainProfileId: MAIN_PROFILE_ID, decisions })(store)
  return { store, decisions }
}

test('removing the last item locally does not ask for confirmation', async () => {
  const { store, decisions } = trackedStore({ history: { historyCacheSorted: [{ videoId: 'only' }] } })
  assert.throws(() => mergeIds([], ['only'], ['only'], { collection: 'history' }), SyncServerDataLossError)

  await store.dispatch('removeFromHistory', () => { store.state.history.historyCacheSorted = [] })
  assert.deepEqual(Array.from(mergeIds([], ['only'], ['only'], { collection: 'history', deletions: decisions.snapshot() })), [])
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
  const previous = ['a', 'b']
  const deletions = { subscriptions: { kept: previous } }
  assert.deepEqual(Array.from(mergeIds(previous, [], previous, { collection: 'subscriptions', deletions })), previous)
  assert.deepEqual(Array.from(mergeIds([], previous, previous, { collection: 'subscriptions', deletions })), previous)
  // Decisions belong to one list.
  assert.throws(() => mergeIds(previous, [], previous, { collection: 'history', deletions }), SyncServerDataLossError)
})

test('a partial confirmation still asks about the remaining deletions', () => {
  assert.throws(() => mergeIds([], ['a', 'b'], ['a', 'b'], {
    collection: 'history',
    deletions: { history: { confirmed: ['a'] } },
  }), error => {
    assert.equal(error.deleted, 1)
    assert.deepEqual(error.items, [{ id: 'b', name: 'b' }])
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
