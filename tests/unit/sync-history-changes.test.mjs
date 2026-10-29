import assert from 'node:assert/strict'
import test from 'node:test'

import { createHistoryChangeTracker } from '../../src/renderer/helpers/sync-history-changes.js'
import { applyRemoteHistoryChanges, mergeChangedHistoryBaseline, mergeHistory, selectChangedHistory } from '../../src/renderer/helpers/sync-history-merge.js'

test('history changes are tracked by video ID until a mutation may change any entry', () => {
  const tracker = createHistoryChangeTracker()
  // Nothing is known before the first sync takes the changes.
  assert.equal(tracker.take(), null)
  tracker.record({ type: 'upsertToHistoryCache', payload: { videoId: 'a' } })
  tracker.record({ type: 'updateRecordWatchProgressInHistoryCache', payload: { videoId: 'b', watchProgress: 3 } })
  tracker.record({ type: 'removeFromHistoryCacheById', payload: 'c' })
  tracker.record({ type: 'removeMultipleFromHistoryCache', payload: ['d'] })
  tracker.record({ type: 'applyHistorySyncChanges', payload: { insertions: [{ videoId: 'e' }], updates: [{ videoId: 'f' }], deletions: ['g'] } })
  tracker.record({ type: 'updateRecordLastViewedPlaylistIdInHistoryCache', payload: { videoId: 'h' } })
  const taken = tracker.take()
  assert.deepEqual([...taken].sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  assert.deepEqual([...tracker.take()], [])

  tracker.record({ type: 'upsertToHistoryCache', payload: { videoId: 'z' } })
  tracker.restore(taken)
  assert.deepEqual([...tracker.take()].sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'z'])
  tracker.record({ type: 'setHistoryCacheSorted', payload: [] })
  tracker.record({ type: 'upsertToHistoryCache', payload: { videoId: 'y' } })
  assert.equal(tracker.take(), null)
  tracker.restore(new Set(['x']))
  tracker.restore(null)
  assert.equal(tracker.take(), null)
})

const record = (id, timeWatched, extra = {}) => ({
  videoId: id, title: `Video ${id}`, author: 'Channel', authorId: 'UC-channel', published: 1, description: '',
  lengthSeconds: 100, watchProgress: 10, isWatched: false, timeWatched, isLive: false, type: 'video', ...extra,
})

function converged(count) {
  const local = Array.from({ length: count }, (_, index) => record(`v${index}`, 1000 + index))
  const first = mergeHistory({ localHistory: local, remoteHistory: [], previous: {} })
  return { local, remote: applyRemoteHistoryChanges({ history: [], upserts: first.historyToUpload, deletions: [] }), previous: first.next }
}

test('merging only the changed entries matches the full merge', () => {
  const { local, remote, previous } = converged(40)
  const edited = local
    .filter(entry => !['v3', 'v4'].includes(entry.videoId))
    .map(entry => entry.videoId === 'v1' ? { ...entry, timeWatched: 5000, watchProgress: 60 } : entry)
    .concat(record('new', 6000))
  const changedIds = new Set(['v1', 'v3', 'v4', 'new'])
  const full = mergeHistory({ localHistory: edited, remoteHistory: remote, previous })
  const subset = selectChangedHistory({ localHistory: edited, remoteHistory: remote, previous, changedIds })
  const changed = mergeHistory({ ...subset, options: { allowDataLoss: true } })
  changed.next = mergeChangedHistoryBaseline(previous, changedIds, changed.next)
  assert.equal(subset.localHistory.length, 2)
  assert.equal(subset.remoteHistory.length, 3)
  for (const key of ['next', 'baselineChanged', 'historyToUpload', 'remoteDeletions', 'insertions', 'updates', 'deletions']) {
    assert.deepEqual(changed[key], full[key], key)
  }
  assert.equal(full.historyToUpload.length, 2)
  assert.deepEqual(full.remoteDeletions.sort(), ['v3', 'v4'])
})

test('deletions that need confirmation take the full merge', () => {
  const { local, remote, previous } = converged(40)
  const ids = local.slice(0, 10).map(entry => entry.videoId)
  const kept = local.slice(10)
  assert.equal(selectChangedHistory({ localHistory: kept, remoteHistory: remote, previous, changedIds: new Set(ids) }), null)
  assert.ok(selectChangedHistory({ localHistory: local.slice(9), remoteHistory: remote, previous, changedIds: new Set(ids.slice(0, 9)) }))
  assert.equal(selectChangedHistory({ localHistory: [], remoteHistory: remote, previous, changedIds: new Set(['v0']) }), null)
  assert.equal(selectChangedHistory({ localHistory: local, remoteHistory: remote, previous: ['v0'], changedIds: new Set(['v0']) }), null)
})
