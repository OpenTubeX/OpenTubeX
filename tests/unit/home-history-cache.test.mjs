import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { isProxy, toRaw } from 'vue'
import { createStore } from 'vuex'
import { getContinueWatchingCandidates } from '../../src/renderer/helpers/homeSections.js'
import { canMarkHistoryEntryAsWatched, compareHistoryRecordsNewestFirst, getRetentionCutoff, migrateLegacyHistoryRecord } from '../../src/history.js'
import { readLegacyExternalMediaPositions, removeLegacyExternalMediaPositions } from '../../src/renderer/helpers/externalMediaHistory.js'

const source = (await readFile(new URL('../../src/renderer/store/modules/history.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace('export default ', 'return ')

function fixture(DBHistoryHandlers = {}, rootGetters = {}) {
  const dependencies = {
    getContinueWatchingCandidates, canMarkHistoryEntryAsWatched, compareHistoryRecordsNewestFirst, getRetentionCutoff, migrateLegacyHistoryRecord, toRaw, DBHistoryHandlers, readLegacyExternalMediaPositions, removeLegacyExternalMediaPositions,
  }
  const history = compileFunction(source, Object.keys(dependencies))(...Object.values(dependencies))
  return createStore({ modules: { history }, getters: rootGetters })
}

const video = (videoId, watchProgress = 10) => ({ videoId, watchProgress, lengthSeconds: 100, timeWatched: 1000 })

test('the shared Home shelf stays cached and updates after progress, status and structural mutations', () => {
  const store = fixture()
  const entries = [video('partial'), video('unstarted', 0)]
  store.commit('setHistoryCacheSorted', entries)
  store.commit('setHistoryCacheById', Object.fromEntries(entries.map(entry => [entry.videoId, entry])))
  const selected = () => store.getters.getContinueWatchingHistory()
  const ids = () => selected().map(entry => entry.videoId)
  assert.deepEqual(ids(), ['partial'])
  assert.equal(selected(), selected())
  store.commit('updateRecordWatchProgressInHistoryCache', { videoId: 'unstarted', watchProgress: 5 })
  assert.deepEqual(ids(), ['partial', 'unstarted'])
  store.commit('upsertToHistoryCache', { ...entries[0], isWatched: true })
  assert.deepEqual(ids(), ['unstarted'])
  store.commit('applyHistorySyncChanges', { insertions: [video('synced')], updates: [], deletions: ['unstarted'] })
  assert.deepEqual(ids(), ['synced'])
  store.commit('removeFromHistoryCacheById', 'synced')
  assert.deepEqual(ids(), [])
  store.commit('setHistoryCacheSorted', [video('replacement')])
  assert.deepEqual(ids(), ['replacement'])
})

test('playback saves leave the history entries revision unchanged', () => {
  const store = fixture()
  const entries = [video('first'), video('second')]
  store.commit('setHistoryCacheSorted', entries)
  store.commit('setHistoryCacheById', Object.fromEntries(entries.map(entry => [entry.videoId, entry])))
  const revisions = () => [store.state.history.historyRevision, store.state.history.historyEntriesRevision]
  const [revision, entriesRevision] = revisions()
  store.commit('updateRecordWatchProgressInHistoryCache', { videoId: 'first', watchProgress: 50 })
  store.commit('updateRecordLastViewedPlaylistIdInHistoryCache', { videoId: 'first', lastViewedPlaylistId: 'playlist' })
  // Sync conflict detection still sees every change.
  assert.deepEqual(revisions(), [revision + 2, entriesRevision])
  store.commit('upsertToHistoryCache', { ...entries[1], isWatched: true })
  assert.deepEqual(revisions(), [revision + 3, entriesRevision + 1])
})

test('a newer watch time for the newest entry updates it in place', () => {
  const store = fixture()
  const entries = [video('newest'), video('older')]
  store.commit('setHistoryCacheSorted', entries)
  store.commit('setHistoryCacheById', Object.fromEntries(entries.map(entry => [entry.videoId, entry])))
  const sorted = toRaw(store.state.history.historyCacheSorted)
  store.commit('upsertToHistoryCache', { ...entries[0], timeWatched: 2000 })
  assert.equal(toRaw(store.state.history.historyCacheSorted), sorted)
  assert.deepEqual(sorted.map(entry => [entry.videoId, entry.timeWatched]), [['newest', 2000], ['older', 1000]])
  store.commit('upsertToHistoryCache', { ...entries[1], timeWatched: 3000 })
  assert.deepEqual(toRaw(store.state.history.historyCacheSorted).map(entry => entry.videoId), ['older', 'newest'])
})

test('removals publish a plain history list without rewriting the previous one', () => {
  const store = fixture()
  const entries = Array.from({ length: 1000 }, (_, index) => video(`video-${index}`))
  store.commit('setHistoryCacheSorted', entries)
  store.commit('setHistoryCacheById', Object.fromEntries(entries.map(entry => [entry.videoId, entry])))
  const sorted = () => toRaw(store.state.history.historyCacheSorted)

  store.commit('removeFromHistoryCacheById', 'video-0')
  // Splicing through the proxy would have shifted every remaining index.
  assert.equal(entries.length, 1000)
  assert.equal(sorted().length, 999)
  assert.equal(sorted()[0].videoId, 'video-1')
  assert.equal(store.state.history.historyCacheById['video-0'], undefined)

  store.commit('removeMultipleFromHistoryCache', ['video-1', 'video-999'])
  assert.deepEqual([sorted().length, sorted()[0].videoId, sorted().at(-1).videoId], [997, 'video-2', 'video-998'])
  assert.equal(sorted().filter(isProxy).length, 0)
  assert.equal(store.state.history.historyCacheById['video-999'], undefined)
})

test('retention cleanup reads the datastore and changes the cache only when entries expired', async t => {
  const day = 24 * 60 * 60 * 1000
  t.mock.method(Date, 'now', () => 100 * day)
  const calls = []
  let deleted = []
  const store = fixture({ deleteOlderThan: async cutoff => { calls.push(cutoff); return deleted } })
  const entries = [{ ...video('recent'), timeWatched: 99 * day }, { videoId: 'progress-only', watchProgress: 5 }]
  store.commit('setHistoryCacheSorted', entries)
  store.commit('setHistoryCacheById', Object.fromEntries(entries.map(entry => [entry.videoId, entry])))
  const revision = () => store.state.history.historyRevision
  const before = revision()

  assert.equal(await store.dispatch('removeHistoryOlderThan', 30), 0)
  assert.deepEqual([calls.length, revision()], [0, before])

  // An expired entry that is still playing in another window is kept.
  store.commit('upsertToHistoryCache', { ...video('expired'), timeWatched: 60 * day })
  const afterInsert = revision()
  assert.equal(await store.dispatch('removeHistoryOlderThan', 30), 0)
  assert.deepEqual([calls, revision()], [[70 * day], afterInsert])

  deleted = ['expired']
  assert.equal(await store.dispatch('removeHistoryOlderThan', 30), 1)
  assert.equal(calls.length, 2)
  assert.deepEqual(toRaw(store.state.history.historyCacheSorted).map(entry => entry.videoId), ['recent', 'progress-only'])
})

test('loading history with retention deletes only when the loaded entries contain expired ones', async t => {
  const day = 24 * 60 * 60 * 1000
  t.mock.method(Date, 'now', () => 100 * day)
  let records = [{ ...video('recent'), timeWatched: 99 * day }]
  const calls = []
  const store = fixture({
    find: async () => records,
    deleteOlderThan: async cutoff => {
      calls.push(cutoff)
      records = records.filter(record => record.videoId !== 'expired')
      return ['expired']
    },
  }, { getHistoryRetentionDays: () => 30 })

  await store.dispatch('grabHistory')
  assert.deepEqual([calls.length, toRaw(store.state.history.historyCacheSorted).length], [0, 1])

  records = [...records, { ...video('expired'), timeWatched: 60 * day }, { ...video('playing'), timeWatched: 60 * day }]
  await store.dispatch('grabHistory')
  assert.deepEqual(calls, [70 * day])
  assert.deepEqual(toRaw(store.state.history.historyCacheSorted).map(entry => entry.videoId), ['recent', 'playing'])
  assert.deepEqual(Object.keys(store.state.history.historyCacheById), ['recent', 'playing'])
})

test('loading history drops an expired entry that another window deleted meanwhile', async t => {
  const day = 24 * 60 * 60 * 1000
  t.mock.method(Date, 'now', () => 100 * day)
  let records = [{ ...video('recent'), timeWatched: 99 * day }, { ...video('expired'), timeWatched: 60 * day }]
  const store = fixture({
    find: async () => records,
    // The other window's cleanup ran between this window's read and its own
    deleteOlderThan: async () => {
      records = records.filter(record => record.videoId !== 'expired')
      return []
    },
  }, { getHistoryRetentionDays: () => 30 })

  await store.dispatch('grabHistory')
  assert.deepEqual(toRaw(store.state.history.historyCacheSorted).map(entry => entry.videoId), ['recent'])
  assert.deepEqual(Object.keys(store.state.history.historyCacheById), ['recent'])
})

test('loading history keeps an entry another window added during the retention cleanup', async t => {
  const day = 24 * 60 * 60 * 1000
  t.mock.method(Date, 'now', () => 100 * day)
  let stored = [{ ...video('expired'), timeWatched: 60 * day }]
  const store = fixture({
    find: async () => stored,
    deleteOlderThan: async () => {
      // Another window saves a new entry while this cleanup runs.
      stored = [{ ...video('added'), timeWatched: 99 * day }]
      return ['expired']
    },
  }, { getHistoryRetentionDays: () => 30 })

  await store.dispatch('grabHistory')
  assert.deepEqual(toRaw(store.state.history.historyCacheSorted).map(entry => entry.videoId), ['added'])
})

test('history sorting puts progress-only records without a watch time last', async () => {
  const progressOnly = { videoId: 'progress-only', watchProgress: 5 }
  const older = { ...video('older'), timeWatched: 1 }
  const newer = { ...video('newer'), timeWatched: 3 }
  let saved = null
  const store = fixture({ overwrite: async records => { saved = records.map(record => record.videoId) } })
  const order = () => store.state.history.historyCacheSorted.map(record => record.videoId)

  assert.equal(await store.dispatch('overwriteHistory', new Map([progressOnly, older, newer].map(record => [record.videoId, record]))), true)
  assert.deepEqual(saved, ['newer', 'older', 'progress-only'])
  assert.deepEqual(order(), ['newer', 'older', 'progress-only'])

  store.commit('setHistoryCacheSorted', [progressOnly, older])
  store.commit('applyHistorySyncChanges', { insertions: [newer], updates: [], deletions: [] })
  assert.deepEqual(order(), ['newer', 'older', 'progress-only'])
})
