import assert from 'node:assert/strict'
import test from 'node:test'

import { sortSearchHistoryByLastUpdatedAt } from '../../src/renderer/helpers/search-history.js'

test('sorts overwritten search history by newest update first', () => {
  const older = { _id: 'older search', lastUpdatedAt: 100 }
  const newer = { _id: 'newer search', lastUpdatedAt: 200 }
  const historyItems = [older, newer]

  const sorted = sortSearchHistoryByLastUpdatedAt(historyItems)

  assert.equal(sorted, historyItems)
  assert.deepEqual(sorted, [newer, older])
})
