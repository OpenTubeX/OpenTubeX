import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { createDesktopDatastore } from '../../src/datastores/sqliteNode.js'

const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')

test('a failed search history import keeps the saved history', async (t) => {
  const db = { searchHistory: createDesktopDatastore(':memory:') }
  t.after(() => db.searchHistory.driver.close())
  const SearchHistory = vm.runInNewContext(
    source.slice(source.indexOf('class SearchHistory {'), source.indexOf('\nclass SubscriptionCache {')) + '\nSearchHistory',
    { db }
  )
  const saved = { _id: 'saved', query: 'saved', lastUpdatedAt: 1 }
  await db.searchHistory.insertAsync(saved)

  // Duplicate IDs in an imported file make the insertion fail
  await assert.rejects(SearchHistory.overwrite([
    { _id: 'imported', query: 'a', lastUpdatedAt: 2 },
    { _id: 'imported', query: 'b', lastUpdatedAt: 3 },
  ]), error => error.errorType === 'uniqueViolated')
  assert.deepEqual(await SearchHistory.find(), [saved])

  await SearchHistory.overwrite([{ _id: 'imported', query: 'a', lastUpdatedAt: 2 }])
  assert.deepEqual(await SearchHistory.find(), [{ _id: 'imported', query: 'a', lastUpdatedAt: 2 }])
})
