import assert from 'node:assert/strict'
import test from 'node:test'

import { effect, stop } from 'vue'
import { datastoreHandlers, playlistStore } from '../helpers/library-performance.mjs'

function countedIds (ids) {
  let reads = 0
  return {
    ids: new Proxy(ids, {
      get (target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++
        return Reflect.get(target, key, receiver)
      },
    }),
    reads: () => reads,
  }
}

test('playing or renaming a large playlist leaves video membership subscribers alone', async () => {
  const store = await playlistStore()
  store.commit('setAllPlaylists', [{ _id: 'playlist', videos: Array.from({ length: 2000 }, (_, index) => ({ videoId: `video-${index}` })) }])
  let renders = 0
  const subscription = effect(() => {
    assert.equal(store.getters.getPlaylistVideoCounts.has('video-0'), true)
    renders++
  })
  try {
    store.commit('upsertPlaylistToList', { _id: 'playlist', lastPlayedAt: 123 })
    store.commit('upsertPlaylistToList', { _id: 'playlist', playlistName: 'Renamed' })
    assert.equal(renders, 1, 'metadata changes must not delete/reinsert every video count')
    assert.equal(store.getters.getPlaylistVideoCounts.size, 2000)
  } finally {
    stop(subscription)
  }
})

test('playlist replacement still updates duplicate counts across playlists', async () => {
  const store = await playlistStore()
  store.commit('setAllPlaylists', [
    { _id: 'one', videos: [{ videoId: 'a' }, { videoId: 'a' }, { videoId: 'b' }] },
    { _id: 'two', videos: [{ videoId: 'a' }] },
  ])
  store.commit('upsertPlaylistToList', { _id: 'one', videos: [{ videoId: 'b' }, { videoId: 'c' }] })
  assert.deepEqual([...store.getters.getPlaylistVideoCounts].sort(), [['a', 1], ['b', 1], ['c', 1]])
  store.commit('upsertPlaylistToList', { _id: 'one', videos: [] })
  assert.deepEqual([...store.getters.getPlaylistVideoCounts], [['a', 1]])
})

test('history loading prepares indexed progress and bulk metadata writes', async () => {
  const { db, History } = await datastoreHandlers()
  const records = Array.from({ length: 2000 }, (_, index) => ({ videoId: `video-${index}`, timeWatched: index, isWatched: false }))
  await db.history.insertAsync(records)
  await History.find()
  const candidates = db.history._getCandidatesAsync.bind(db.history)
  let visited = 0
  db.history._getCandidatesAsync = async (...args) => {
    const result = await candidates(...args)
    visited += result.length
    return result
  }
  await History.updateWatchProgress('video-0', 123)
  await History.updateSubscriptionState({ records: records.slice(0, 10).map(record => ({ ...record, title: 'Updated' })) })
  assert.equal((await db.history.findOneAsync({ videoId: 'video-0' })).title, 'Updated')
  assert.ok(visited <= 32, `history writes visited ${visited} records instead of indexed matches`)
})

test('bulk playlist deletion reads selected IDs linearly and keeps duplicate video instances distinct', async () => {
  const { db, Playlists } = await datastoreHandlers()
  const videos = Array.from({ length: 2000 }, (_, index) => ({ videoId: 'same-video', playlistItemId: `item-${index}` }))
  await db.playlists.insertAsync({ _id: 'playlist', videos, description: 'Keep metadata' })
  const selected = countedIds(videos.slice(0, 1000).map(video => video.playlistItemId))
  await Playlists.deleteVideoIdsByPlaylistId('playlist', 123, selected.ids)
  const playlist = await db.playlists.findOneAsync({ _id: 'playlist' })
  assert.deepEqual(playlist.videos.map(video => video.playlistItemId), videos.slice(1000).map(video => video.playlistItemId))
  assert.equal(playlist.description, 'Keep metadata')
  assert.equal(playlist.lastUpdatedAt, 123)
  assert.ok(selected.reads() <= 4000, `bulk deletion repeatedly read selected IDs ${selected.reads()} times`)
})

test('history retention deletes the selected records without a quadratic ID scan', async () => {
  const { db, History } = await datastoreHandlers()
  const records = Array.from({ length: 2000 }, (_, index) => ({ videoId: `video-${index}`, timeWatched: index }))
  await db.history.insertAsync(records)
  await db.recommendations.insertAsync({ _id: 'video-0', feedback: 'positive' })
  const remove = db.history.removeAsync.bind(db.history)
  let idReads = 0
  db.history.removeAsync = (query, options) => {
    if (query.videoId?.$in) {
      const counted = countedIds(query.videoId.$in)
      query.videoId.$in = counted.ids
      return remove(query, options).finally(() => { idReads += counted.reads() })
    }
    return remove(query, options)
  }
  const deleted = await History.deleteOlderThan(1000, ['video-0'])
  assert.equal(deleted.length, 999)
  assert.equal(await db.history.countAsync({}), 1001)
  assert.notEqual(await db.history.findOneAsync({ videoId: 'video-0' }), null)
  assert.notEqual(await db.recommendations.findOneAsync({ _id: 'video-0' }), null)
  assert.ok(idReads <= 8000, `retention repeatedly read selected IDs ${idReads} times`)
})

test('sync history deletion scales linearly and preserves updates and recommendation metadata', async () => {
  const { db, History } = await datastoreHandlers()
  const records = Array.from({ length: 1000 }, (_, index) => ({ videoId: `video-${index}`, timeWatched: index, isWatched: false }))
  await db.history.insertAsync(records)
  await db.recommendations.insertAsync(records.map(record => ({ _id: record.videoId })))
  const selected = countedIds(records.slice(0, 500).map(record => record.videoId))
  await History.applySyncChanges({
    insertions: [{ videoId: 'inserted', timeWatched: 2000, isWatched: false }],
    updates: [{ ...records[999], title: 'Updated' }],
    deletions: selected.ids,
  })
  assert.equal(await db.history.countAsync({}), 501)
  assert.equal((await db.history.findOneAsync({ videoId: 'video-999' })).title, 'Updated')
  assert.equal(await db.recommendations.countAsync({ _id: { $ne: 'meta' } }), 500)
  assert.equal((await db.recommendations.findOneAsync({ _id: 'meta' })).revision, 1)
  assert.ok(selected.reads() <= 8000, `sync deletion repeatedly read selected IDs ${selected.reads()} times`)
})
