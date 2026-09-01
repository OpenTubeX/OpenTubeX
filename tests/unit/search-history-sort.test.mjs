import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getSearchHistoryEntryKeyFromEntry,
  mergeSearchHistoryEntries,
  normalizeSearchHistoryEntry,
  resolveSearchHistoryEntry,
  sortSearchHistoryByLastUpdatedAt,
} from '../../src/search-history.js'

test('sorts overwritten search history by newest update first', () => {
  const older = { _id: 'older search', lastUpdatedAt: 100 }
  const newer = { _id: 'newer search', lastUpdatedAt: 200 }
  const historyItems = [older, newer]

  const sorted = sortSearchHistoryByLastUpdatedAt(historyItems)

  assert.equal(sorted, historyItems)
  assert.deepEqual(sorted, [newer, older])
})

test('normalizes legacy search history to a static default filter set', () => {
  assert.deepEqual(normalizeSearchHistoryEntry({ _id: 'legacy query', lastUpdatedAt: 100 }), {
    _id: 'legacy query',
    query: 'legacy query',
    lastUpdatedAt: 100,
    searchSettings: {
      prioritize: 'relevance',
      time: '',
      type: 'all',
      duration: '',
      features: [],
    },
  })
})

test('keeps the same query with different filters as separate history entries', () => {
  const today = {
    _id: 'today',
    query: 'daily news',
    lastUpdatedAt: 100,
    searchSettings: { time: 'today' },
  }
  const week = {
    _id: 'week',
    query: 'daily news',
    lastUpdatedAt: 200,
    searchSettings: { time: 'week' },
  }

  const merged = mergeSearchHistoryEntries([], [today, week])

  assert.equal(merged.length, 2)
  assert.notEqual(merged[0]._id, merged[1]._id)
  assert.notEqual(
    getSearchHistoryEntryKeyFromEntry(merged[0]),
    getSearchHistoryEntryKeyFromEntry(merged[1])
  )
})

test('treats reordered and duplicate features as one filter set', () => {
  const hdThen4k = normalizeSearchHistoryEntry({
    _id: 'first',
    query: 'trailers',
    lastUpdatedAt: 100,
    searchSettings: { features: ['hd', '4k', 'hd'] },
  })
  const fourKThenHd = normalizeSearchHistoryEntry({
    _id: 'second',
    query: 'trailers',
    lastUpdatedAt: 200,
    searchSettings: { features: ['4k', 'hd'] },
  })

  assert.deepEqual(hdThen4k.searchSettings.features, ['4k', 'hd'])
  assert.deepEqual(mergeSearchHistoryEntries([hdThen4k], [fourKThenHd]), [{
    ...fourKThenHd,
    _id: 'first',
  }])
})

test('updates matching query and filter imports without replacing their id', () => {
  const existing = {
    _id: 'existing-id',
    query: 'daily news',
    lastUpdatedAt: 100,
    searchSettings: { time: 'today' },
  }
  const imported = {
    _id: 'imported-id',
    query: 'daily news',
    lastUpdatedAt: 200,
    searchSettings: { time: 'today' },
  }

  assert.deepEqual(mergeSearchHistoryEntries([existing], [imported]), [{
    ...normalizeSearchHistoryEntry(imported),
    _id: 'existing-id',
  }])
})

test('preserves a matching legacy id when history has not loaded into the store yet', () => {
  const legacyEntry = {
    _id: 'trailers',
    lastUpdatedAt: 100,
    searchSettings: { features: ['hd', '4k'] },
  }
  const submittedEntry = {
    query: 'trailers',
    lastUpdatedAt: 200,
    searchSettings: { features: ['4k', 'hd'] },
  }

  assert.deepEqual(resolveSearchHistoryEntry(submittedEntry, [legacyEntry]), {
    _id: 'trailers',
    query: 'trailers',
    lastUpdatedAt: 200,
    searchSettings: {
      prioritize: 'relevance',
      time: '',
      type: 'all',
      duration: '',
      features: ['4k', 'hd'],
    },
  })
})
