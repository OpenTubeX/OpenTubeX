import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { createDesktopDatastore } from '../../src/datastores/sqliteNode.js'
import { mergeSearchHistoryEntries, resolveSearchHistoryEntry, sortSearchHistoryByLastUpdatedAt } from '../../src/search-history.js'

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
