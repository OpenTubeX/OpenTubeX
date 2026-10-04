import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { toRaw } from 'vue'
import { createStore } from 'vuex'
import { getContinueWatchingCandidates } from '../../src/renderer/helpers/homeSections.js'
import { canMarkHistoryEntryAsWatched } from '../../src/history.js'

const source = (await readFile(new URL('../../src/renderer/store/modules/history.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace('export default ', 'return ')

function fixture() {
  const history = compileFunction(source, ['getContinueWatchingCandidates', 'canMarkHistoryEntryAsWatched', 'toRaw'])(getContinueWatchingCandidates, canMarkHistoryEntryAsWatched, toRaw)
  return createStore({ modules: { history } })
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
