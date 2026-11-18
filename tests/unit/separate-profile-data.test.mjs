import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { migrateLegacyHistoryRecord, newestUniqueHistoryRecords } from '../../src/history.js'
import { mergeSearchHistoryEntries, resolveSearchHistoryEntry, sortSearchHistoryByLastUpdatedAt } from '../../src/search-history.js'
import * as seenVideos from '../../src/subscriptionSeenVideos.js'
import { createIdQuery } from '../../src/datastores/idQuery.js'
import { createRecommendationStore } from '../../src/datastores/recommendations.js'
import { profileDatastorePrefix } from '../../src/datastores/profileDatastoreNames.js'
import { MAIN_PROFILE_ID } from '../../src/constants.js'
import { mergeBackupProfile, mergeImportedProfile, withProfileSeparation } from '../../src/renderer/helpers/unifiedBackup.js'

const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
const handlerSource = source.slice(source.indexOf('class Settings {'), source.indexOf('\nclass SubscriptionCache {')) +
  source.slice(source.indexOf('/** @type {Map<string, ReturnType<typeof createScopedHandlers>>} */'), source.indexOf('function loadDatastores()'))

function fixture() {
  const store = () => new Datastore({ inMemoryOnly: true })
  const scoped = new Map()
  const dropped = []
  const db = {
    settings: store(),
    profiles: store(),
    history: store(),
    playlists: store(),
    searchHistory: store(),
    watchStats: store(),
    recommendations: store(),
    profileDatastores(scope) {
      if (!scoped.has(scope)) {
        scoped.set(scope, Object.fromEntries(['history', 'playlists', 'searchHistory', 'watchStats', 'recommendations'].map(name => [name, store()])))
      }
      return scoped.get(scope)
    },
    async dropProfileDatastores(scope) {
      dropped.push(scope)
      scoped.delete(scope)
    },
  }
  const handlers = vm.runInNewContext(`${handlerSource}\n({ scopedHandlers, onScopeDataDeleted, Profiles })`, {
    db,
    ...seenVideos,
    migrateLegacyHistoryRecord,
    newestUniqueHistoryRecords,
    mergeSearchHistoryEntries,
    resolveSearchHistoryEntry,
    sortSearchHistoryByLastUpdatedAt,
    createIdQuery,
    createRecommendationStore,
    mergeBackupProfile,
    mergeImportedProfile,
    withProfileSeparation,
    recommendations: createRecommendationStore(db.recommendations),
    loadProfilesDatastore: async () => {},
    DEFAULT_PROFILE_ICON: {},
    MAIN_PROFILE_ID,
    HISTORY_WATCHED_STATUS_MIGRATION_ID: 'historyWatchedStatusMigrated',
    crypto,
    console,
  })
  return { db, scoped, dropped, ...handlers }
}

test('a separate profile’s history, playlists, searches and watch time never reach the shared data', async () => {
  const { db, scoped, scopedHandlers } = fixture()
  await db.settings.insertAsync({ _id: 'historyWatchedStatusMigrated', value: true })
  const shared = scopedHandlers(null)
  const separate = scopedHandlers('separate')
  assert.equal(scopedHandlers('separate'), separate, 'a scope keeps its handlers')

  await separate.history.upsert({ videoId: 'separateVideo', timeWatched: 2, watchProgress: 10 })
  await shared.history.upsert({ videoId: 'sharedVideo', timeWatched: 1, watchProgress: 5 })
  await separate.playlists.create([{ _id: 'favorites', playlistName: 'Favorites', videos: [{ videoId: 'separateVideo' }] }])
  await separate.searchHistory.upsert({ _id: 'query', query: 'query', lastUpdatedAt: 1 })
  await separate.watchStats.addWatchTime('2026-11-17', 30)

  assert.deepEqual((await shared.history.find()).map(record => record.videoId), ['sharedVideo'])
  assert.deepEqual((await separate.history.find()).map(record => record.videoId), ['separateVideo'])
  assert.deepEqual(await db.playlists.findAsync({}), [])
  assert.deepEqual(await db.searchHistory.findAsync({}), [])
  assert.deepEqual(await db.watchStats.findAsync({}), [])
  assert.equal((await scoped.get('separate').playlists.findAsync({})).length, 1)
  assert.deepEqual((await separate.watchStats.find()).map(record => record.seconds), [30])

  // Clearing a separate profile's history keeps the shared one.
  await separate.history.deleteAll()
  assert.deepEqual((await shared.history.find()).map(record => record.videoId), ['sharedVideo'])
})

test('deleting a separate profile deletes its data, and deleting another profile keeps it', async () => {
  const { db, dropped, scopedHandlers, onScopeDataDeleted, Profiles } = fixture()
  const deletedQueues = []
  onScopeDataDeleted(scope => { deletedQueues.push(scope) })
  await Profiles.create({ _id: 'separate', name: 'Kids', separate: true, subscriptions: [] })
  await Profiles.create({ _id: 'shared', name: 'Music', subscriptions: [] })
  const before = scopedHandlers('separate')

  await Profiles.delete('shared')
  assert.deepEqual(dropped, [])
  await Profiles.delete('separate')
  assert.deepEqual(dropped, ['separate'])
  assert.deepEqual(deletedQueues, ['separate'])
  assert.notEqual(scopedHandlers('separate'), before, 'a later profile with this ID starts empty')
  assert.deepEqual(await db.profiles.findAsync({}), [])
})

test('a profile keeps whether its data is separate, and the main profile never is', async () => {
  const { Profiles } = fixture()
  await Profiles.create({ _id: MAIN_PROFILE_ID, name: null, separate: true, subscriptions: [] })
  await Profiles.create({ _id: 'separate', name: 'Kids', separate: true, subscriptions: [] })
  await Profiles.create({ _id: 'shared', name: 'Music', subscriptions: [] })
  // New profiles get their ID from the datastore.
  const created = await Profiles.create({ name: 'New', separate: true, subscriptions: [] })
  assert.equal(await Profiles.isSeparate(created._id), true)
  assert.equal(await Profiles.isSeparate(MAIN_PROFILE_ID), false)
  assert.equal(await Profiles.isSeparate('separate'), true)

  // Restores and full saves can't move a profile's data to or from the shared data.
  await Profiles.mergeBackup({ _id: 'separate', name: 'Kids', subscriptions: [] })
  await Profiles.upsert({ _id: 'shared', name: 'Music', separate: true, subscriptions: [] })
  assert.equal(await Profiles.isSeparate('separate'), true)
  assert.equal(await Profiles.isSeparate('shared'), false)
})

test('separate profiles get valid, distinct datastore names on every platform', () => {
  const names = ['a', 'A', 'Ab+/=', 'ü', 'x'.repeat(64)].map(profileDatastorePrefix)
  assert.equal(new Set(names).size, names.length)
  // The Android and iOS database plugins only accept these characters.
  for (const name of names) assert.match(`${name}-search-history`, /^[a-z0-9-]+$/)
  for (const invalid of ['', 'x'.repeat(65), null]) assert.throws(() => profileDatastorePrefix(invalid), TypeError)
})

test('a write that finishes after a switch to another profile leaves that profile’s shown data alone', async () => {
  const { scopedActions } = await import('../../src/renderer/helpers/dataScopeActions.js')
  const { setDataScope } = await import('../../src/datastores/handlers/dataScope.js')
  let finishWrite
  const commits = []
  const actions = scopedActions({
    async updateHistory({ commit }, record) {
      await new Promise(resolve => { finishWrite = resolve })
      commit('upsertToHistoryCache', record)
    },
  })
  const context = { commit: (type, payload) => commits.push([type, payload.videoId]) }
  try {
    setDataScope(null)
    const shared = actions.updateHistory(context, { videoId: 'shared' })
    setDataScope('separate')
    finishWrite()
    await shared
    const separate = actions.updateHistory(context, { videoId: 'separate' })
    finishWrite()
    await separate
    assert.deepEqual(commits, [['upsertToHistoryCache', 'separate']])
  } finally {
    setDataScope(null)
  }
})

test('a profile switch waits for running writes, so their later requests stay in the profile they started in', async () => {
  const { scopedActions, settleScopedActions } = await import('../../src/renderer/helpers/dataScopeActions.js')
  const { getDataScope, setDataScope } = await import('../../src/datastores/handlers/dataScope.js')
  let finishFirstStep
  const requests = []
  const actions = scopedActions({
    async removeAllVideos() {
      requests.push(getDataScope())
      await new Promise(resolve => { finishFirstStep = resolve })
      requests.push(getDataScope())
    },
  })
  try {
    setDataScope(null)
    const removal = actions.removeAllVideos({ commit() {} })
    // Like `loadDataScope`
    const switched = settleScopedActions().then(() => setDataScope('separate'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(getDataScope(), null, 'the switch waits for the running write')
    finishFirstStep()
    await Promise.all([removal, switched])
    assert.deepEqual(requests, [null, null])
    assert.equal(getDataScope(), 'separate')
  } finally {
    setDataScope(null)
  }
})
