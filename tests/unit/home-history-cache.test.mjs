import Datastore from '@seald-io/nedb'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { toRaw } from 'vue'
import { createStore } from 'vuex'
import model from '@seald-io/nedb/lib/model.js'
import { getContinueWatchingCandidates } from '../../src/renderer/helpers/homeSections.js'
import { canMarkHistoryEntryAsWatched } from '../../src/history.js'

const source = (await readFile(new URL('../../src/renderer/store/modules/history.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace('export default ', 'return ')

function fixture(electron = false) {
  const history = compileFunction(source, ['getContinueWatchingCandidates', 'canMarkHistoryEntryAsWatched', 'toRaw', 'model', 'process'])(getContinueWatchingCandidates, canMarkHistoryEntryAsWatched, toRaw, model, { env: { IS_ELECTRON: electron } })
  return createStore({ modules: { history } })
}

const video = (videoId, watchProgress = 10) => ({ videoId, watchProgress, lengthSeconds: 100, timeWatched: 1000 })

test('desktop history pages retain newest per-video state across page order and tied IDs', () => {
  const store = fixture(true)
  const newest = { ...video('same', 75), _id: '\uE000', timeWatched: 2, isWatched: true, unknown: new Date(1) }
  const older = { ...newest, _id: 'old', timeWatched: 1, watchProgress: 10, isWatched: false }
  const tied = { ...older, _id: '😀', timeWatched: 2 }
  for (const pages of [[newest, older, tied], [older, tied, newest]]) {
    store.commit('cacheHistoryRecords', { ids: ['same'], records: [] })
    for (const record of pages) store.commit('cacheHistoryRecords', [record])
    assert.deepEqual(store.getters.getHistoryCacheById.same, newest)
  }
  const refreshed = { ...newest, watchProgress: 99 }
  store.commit('cacheHistoryRecords', [refreshed])
  assert.deepEqual(store.getters.getHistoryCacheById.same, refreshed)
  store.commit('cacheHistoryRecords', { ids: ['same'], records: [older] })
  assert.deepEqual(store.getters.getHistoryCacheById.same, older)
})

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

test('reopening Home rechecks premiere eligibility after the clock advances without a history mutation', t => {
  let now = 10000
  t.mock.method(Date, 'now', () => now)
  const store = fixture()
  store.commit('setHistoryCacheSorted', [{
    ...video('premiere'), isUpcoming: true, premiereTimestamp: 20,
  }])
  assert.equal(store.getters.getContinueWatchingHistory().length, 0)
  now = 21000
  assert.deepEqual(store.getters.getContinueWatchingHistory().map(entry => entry.videoId), ['premiere'])
})

test('playlist metadata updates retain the cached Continue watching selection', () => {
  const store = fixture()
  const entry = video('partial')
  store.commit('setHistoryCacheSorted', [entry])
  store.commit('setHistoryCacheById', { partial: entry })
  const selected = store.getters.getContinueWatchingHistory()
  store.commit('updateRecordLastViewedPlaylistIdInHistoryCache', {
    videoId: 'partial', lastViewedPlaylistId: 'playlist', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: 'item',
  })
  assert.equal(store.getters.getContinueWatchingHistory(), selected)
  store.commit('unsetRecordsLastViewedPlaylistIdInHistoryCache', { videoIds: ['partial'], lastViewedPlaylistId: 'playlist' })
  assert.equal(store.getters.getContinueWatchingHistory(), selected)
  store.commit('updateRecordLastViewedPlaylistIdInHistoryCache', { videoId: 'partial', lastViewedPlaylistId: 'playlist' })
  store.commit('unsetRecordsLastViewedPlaylistIdsInHistoryCache', ['playlist'])
  assert.equal(store.getters.getContinueWatchingHistory(), selected)
})

test('metadata repair patches only its targets and retains the record-ID index and untouched row references', () => {
  const store = fixture()
  store.state.history.libraryPaged = false
  let visits = 0
  const entries = Array.from({ length: 1000 }, (_, i) => {
    const entry = { ...video(`v${i}`), title: 'Before', unknown: new Date(i) }
    Object.defineProperty(entry, '_id', { enumerable: true, get() { visits++; return `h${i}` } })
    return entry
  })
  store.commit('setHistoryCacheSorted', entries)
  store.commit('setHistoryCacheById', Object.fromEntries(entries.map(entry => [entry.videoId, entry])))
  const sorted = store.getters.getHistoryCacheSorted
  const indexed = store.getters.getHistoryCacheByRecordId
  const untouched = sorted[999]
  for (let batch = 0; batch < 25; batch++) {
    const updates = entries.slice(batch * 4, batch * 4 + 4).map(entry => ({ ...entry, title: 'Repaired' }))
    visits = 0
    store.commit('applyHistoryMetadata', updates)
    const after = store.getters.getHistoryCacheByRecordId
    assert.ok(visits < 50, `four-record repair traversed ${visits} record IDs`)
    assert.equal(after, indexed)
    assert.equal(store.getters.getHistoryCacheSorted, sorted)
    for (const record of updates) assert.deepEqual(after[record._id], record)
  }
  assert.equal(sorted[999], untouched)
  assert.equal(indexed.h999, untouched)
})

test('the record-ID index follows structural cache changes and preserves prototype-named IDs', () => {
  const store = fixture()
  assert.deepEqual(Object.keys(store.getters.getHistoryCacheByRecordId), [])
  store.commit('setHistoryCacheSorted', [{ ...video('first'), _id: '__proto__' }, { ...video('second'), _id: 'b' }])
  assert.equal(store.getters.getHistoryCacheByRecordId.__proto__.videoId, 'first')
  store.commit('removeFromHistoryCacheById', 'first')
  assert.equal(Object.hasOwn(store.getters.getHistoryCacheByRecordId, '__proto__'), false)
  store.commit('upsertToHistoryCache', { ...video('third'), _id: 'c' })
  assert.equal(store.getters.getHistoryCacheByRecordId.c.videoId, 'third')
  store.commit('applyHistorySyncChanges', { insertions: [{ ...video('fourth'), _id: 'd' }], updates: [], deletions: ['second'] })
  assert.deepEqual(Object.keys(store.getters.getHistoryCacheByRecordId).sort(), ['c', 'd'])
  store.commit('setHistoryCacheSorted', [])
  assert.deepEqual(Object.keys(store.getters.getHistoryCacheByRecordId), [])
})

test('same-position upserts reuse the record-ID index instead of scanning every record', () => {
  const store = fixture()
  let visits = 0
  const records = Array.from({ length: 1000 }, (_, index) => {
    const record = { ...video(`v${index}`), unknown: new Date(index) }
    Object.defineProperty(record, '_id', { enumerable: true, get() { visits++; return `h${index}` } })
    return record
  })
  store.commit('setHistoryCacheSorted', records)
  store.commit('setHistoryCacheById', Object.fromEntries(records.map(record => [record.videoId, record])))
  const indexed = store.getters.getHistoryCacheByRecordId
  const untouched = store.getters.getHistoryCacheSorted[999]
  for (let index = 0; index < 100; index++) {
    const updated = { ...records[index], isWatched: true }
    visits = 0
    store.commit('upsertToHistoryCache', updated)
    assert.ok(visits < 10, `one metadata upsert traversed ${visits} record IDs`)
    assert.equal(store.getters.getHistoryCacheByRecordId, indexed)
    assert.deepEqual(indexed[updated._id], updated)
    assert.equal(store.getters.getHistoryCacheSorted[index].videoId, updated.videoId)
  }
  assert.equal(indexed.h999, untouched)
})

test('same-position upserts preserve duplicate-ID index semantics and rebuild after identity changes', () => {
  const store = fixture()
  const first = { ...video('first'), _id: 'same', unknown: new Date(1) }
  const last = { ...video('last'), _id: 'same', unknown: new Date(2) }
  store.commit('setHistoryCacheSorted', [first, last])
  const updated = { ...first, isWatched: true }
  store.commit('upsertToHistoryCache', updated)
  assert.deepEqual(store.getters.getHistoryCacheByRecordId.same, last)
  assert.deepEqual(store.getters.getHistoryCacheSorted, [updated, last])
  const renamed = { ...updated, _id: '__proto__' }
  store.commit('upsertToHistoryCache', renamed)
  assert.deepEqual(store.getters.getHistoryCacheByRecordId.__proto__, renamed)
  assert.deepEqual(store.getters.getHistoryCacheByRecordId.same, last)
})

for (const ids of [[1, '1'], ['1', 1], [true, 'true'], ['true', true]]) {
  for (const mutation of ['upsertToHistoryCache', 'applyHistoryMetadata']) {
    test(`${mutation} preserves object-key collisions for real NeDB IDs ${JSON.stringify(ids)}`, async () => {
      const db = new Datastore({ inMemoryOnly: true })
      const original = await db.insertAsync(ids.map((_id, index) => ({ ...video(`v${index}`), _id, unknown: new Date(index) })))
      const expected = structuredClone(original)
      const store = fixture()
      store.commit('setHistoryCacheSorted', structuredClone(original))
      store.commit('setHistoryCacheById', Object.fromEntries(store.getters.getHistoryCacheSorted.map(record => [record.videoId, record])))
      for (let index = 0; index < expected.length; index++) {
        const updated = { ...expected[index], title: `Updated ${index}` }
        store.commit(mutation, mutation === 'applyHistoryMetadata' ? [updated] : updated)
        expected[index] = updated
        const byId = Object.assign(Object.create(null), Object.fromEntries(expected.map(record => [record._id, record])))
        assert.deepEqual(store.getters.getHistoryCacheSorted, expected)
        assert.deepEqual(store.getters.getHistoryCacheByRecordId, byId)
        assert.deepEqual(store.getters.getHistoryCacheById, Object.fromEntries(expected.map(record => [record.videoId, record])))
      }
      assert.deepEqual(await db.findAsync({}).sort({ videoId: 1 }), original)
    })
  }
}

test('deleting a video removes every restored duplicate from the bounded cache and Home shelf', () => {
  const store = fixture()
  const records = [{ ...video('deleted'), _id: 'first' }, { ...video('keep'), _id: 'retained' }, { ...video('deleted'), _id: 'second' }]
  store.commit('setHistoryCacheSorted', records)
  store.commit('setHistoryCacheById', { deleted: records[2], keep: records[1] })
  store.commit('removeFromHistoryCacheById', 'deleted')
  assert.deepEqual(store.getters.getHistoryCacheSorted, [records[1]])
  assert.deepEqual(store.getters.getHistoryCacheById, { keep: records[1] })
  assert.deepEqual(Object.entries(store.getters.getHistoryCacheByRecordId), [['retained', records[1]]])
  assert.deepEqual(store.getters.getContinueWatchingHistory(), [records[1]])
})
