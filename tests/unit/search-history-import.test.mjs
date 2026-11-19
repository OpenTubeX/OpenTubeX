import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { createStore } from 'vuex'
import { createDesktopDatastore } from '../../src/datastores/sqliteNode.js'
import {
  getSearchHistoryEntryQuery,
  mergeSearchHistoryEntries,
  normalizeSearchHistoryEntry,
  resolveSearchHistoryEntry,
  searchHistoryEntryMatches,
  sortSearchHistoryByLastUpdatedAt,
} from '../../src/search-history.js'
import { createUnifiedBackup, readUnifiedBackup } from '../../src/renderer/helpers/unifiedBackup.js'

const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')

function createSearchHistory(db) {
  return vm.runInNewContext(
    source.slice(source.indexOf('class SearchHistory {'), source.indexOf('\nclass SubscriptionCache {')) + '\nSearchHistory',
    { db, mergeSearchHistoryEntries, resolveSearchHistoryEntry, sortSearchHistoryByLastUpdatedAt }
  )
}

test('a search history import keeps searches saved meanwhile, and a failed one keeps the saved history', async (t) => {
  const db = { searchHistory: createDesktopDatastore(':memory:') }
  t.after(() => db.searchHistory.driver.close())
  const SearchHistory = createSearchHistory(db)
  const saved = { _id: 'saved', query: 'saved', lastUpdatedAt: 1 }
  await db.searchHistory.insertAsync(saved)

  const replaceAll = db.searchHistory.replaceAllAsync.bind(db.searchHistory)
  db.searchHistory.replaceAllAsync = async () => { throw new Error('disk full') }
  await assert.rejects(SearchHistory.mergeImported([{ query: 'imported', lastUpdatedAt: 2 }]), /disk full/)
  assert.deepEqual(await SearchHistory.find(), [saved])
  db.searchHistory.replaceAllAsync = replaceAll

  // A search made in another window while the import runs is kept
  await Promise.all([
    SearchHistory.mergeImported([{ query: 'imported', lastUpdatedAt: 2 }]),
    SearchHistory.upsert({ _id: 'meanwhile', query: 'meanwhile', lastUpdatedAt: 3 }),
  ])
  assert.deepEqual((await SearchHistory.find()).map(entry => entry.query), ['meanwhile', 'imported', 'saved'])
})

test('search history retention removes only searches last used before the cutoff', async (t) => {
  const db = { searchHistory: createDesktopDatastore(':memory:') }
  t.after(() => db.searchHistory.driver.close())
  const SearchHistory = createSearchHistory(db)
  const legacy = { _id: 'legacy', query: 'legacy' }
  await db.searchHistory.insertAsync([
    { _id: 'old', query: 'old', lastUpdatedAt: 1 },
    { _id: 'cutoff', query: 'cutoff', lastUpdatedAt: 10 },
    { _id: 'recent', query: 'recent', lastUpdatedAt: 20 },
    legacy,
  ])

  const remaining = await SearchHistory.deleteOlderThan(10)
  assert.deepEqual(remaining.map(entry => entry._id), ['recent', 'cutoff', 'legacy'])
  assert.deepEqual(await SearchHistory.find(), remaining)
  assert.equal(await SearchHistory.deleteOlderThan(10), null)
})

test('a link keeps its title when it is saved again and when a backup restores it', async (t) => {
  const db = { searchHistory: createDesktopDatastore(':memory:') }
  t.after(() => db.searchHistory.driver.close())
  const SearchHistory = createSearchHistory(db)
  const link = { query: 'https://youtu.be/abcdefghijk', lastUpdatedAt: 1, linkType: 'video', title: 'Old Title' }

  const saved = await SearchHistory.upsert(link)
  const renamed = await SearchHistory.upsert({ ...link, lastUpdatedAt: 2, title: 'New Title' })
  assert.equal(renamed._id, saved._id)
  assert.deepEqual(await SearchHistory.find(), [renamed])
  assert.equal(renamed.title, 'New Title')

  const backup = await readUnifiedBackup(createUnifiedBackup({ searchHistory: await SearchHistory.find() }))
  await SearchHistory.deleteAll()
  await SearchHistory.upsert({ query: 'daily news', lastUpdatedAt: 3 })
  await SearchHistory.mergeImported(backup.data.searchHistory)
  assert.deepEqual((await SearchHistory.find()).map(({ query, linkType, title }) => ({ query, linkType, title })), [
    { query: 'daily news', linkType: undefined, title: undefined },
    { query: link.query, linkType: 'video', title: 'New Title' },
  ])
})

const storeSource = (await readFile(new URL('../../src/renderer/store/modules/search-history.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace('export default ', 'return ')

test('a delayed link save stays in date order, and clearing stops pending saves before the delete finishes', async () => {
  let finishDelete
  const DBSearchHistoryHandlers = {
    upsert: async entry => entry,
    deleteAll: () => new Promise(resolve => { finishDelete = resolve }),
  }
  const dependencies = {
    MIXED_SEARCH_HISTORY_ENTRIES_DISPLAY_LIMIT: 10, DBSearchHistoryHandlers, getRetentionCutoff: () => null, getSearchHistoryEntryQuery, mergeSearchHistoryEntries, normalizeSearchHistoryEntry, resolveSearchHistoryEntry, searchHistoryEntryMatches, sortSearchHistoryByLastUpdatedAt,
  }
  const searchHistory = vm.compileFunction(storeSource, Object.keys(dependencies))(...Object.values(dependencies))
  const store = createStore({ modules: { searchHistory } })

  await store.dispatch('updateSearchHistoryEntry', { query: 'newer search', lastUpdatedAt: 2 })
  await store.dispatch('updateSearchHistoryEntry', { query: 'https://youtu.be/older', lastUpdatedAt: 1, linkType: 'video', title: 'Older' })
  assert.deepEqual(store.getters.getSearchHistoryEntries.map(entry => entry.query), ['newer search', 'https://youtu.be/older'])

  const clearCount = store.getters.getSearchHistoryClearCount
  const cleared = store.dispatch('removeAllSearchHistoryEntries')
  assert.notEqual(store.getters.getSearchHistoryClearCount, clearCount)
  finishDelete()
  assert.equal(await cleared, true)
  assert.deepEqual(store.getters.getSearchHistoryEntries, [])
})
