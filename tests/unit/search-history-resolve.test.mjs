import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveSearchHistoryEntry } from '../../src/search-history.js'

test('a new search builds filter keys only for saved entries with the same query', () => {
  let filterReads = 0
  const existingEntries = Array.from({ length: 5_000 }, (_, index) => ({
    _id: `entry-${index}`,
    query: `query ${index}`,
    lastUpdatedAt: index,
    get searchSettings() { filterReads++; return { time: 'today' } },
  }))
  existingEntries.push(
    { _id: 'same-query-week', query: 'query 1', lastUpdatedAt: 1, searchSettings: { time: 'week' } },
  )

  const resolved = resolveSearchHistoryEntry({ query: 'query 1', lastUpdatedAt: 10, searchSettings: { time: 'week' } }, existingEntries)
  assert.equal(resolved._id, 'same-query-week')
  assert.equal(filterReads, 1, 'only the other "query 1" entry needs its filters compared')

  const created = resolveSearchHistoryEntry({ query: 'query 2', lastUpdatedAt: 10, searchSettings: { time: 'year' } }, existingEntries)
  assert.match(created._id, /^search-history:/)
})
