import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getSearchHistoryEntryKeyFromEntry,
  mergeSearchHistoryEntries,
  normalizeSearchHistoryEntry,
  normalizeSearchSettings,
  parseExportedSearchHistoryEntry,
  resolveSearchHistoryEntry,
  searchHistoryEntryMatches,
} from '../../src/search-history.js'

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

test('keeps valid link titles, and reads them back from an export that older clients and FreeTube can also read', () => {
  const link = {
    _id: 'link',
    query: 'https://www.youtube.com/@ExampleChannel',
    lastUpdatedAt: 300,
    linkType: 'channel',
    title: 'Example Channel',
  }
  assert.deepEqual(normalizeSearchHistoryEntry(link), { ...link, searchSettings: normalizeSearchSettings() })

  // Imports can contain anything, and only links have titles.
  assert.equal('title' in normalizeSearchHistoryEntry({ ...link, linkType: undefined }), false)
  assert.equal('linkType' in normalizeSearchHistoryEntry({ ...link, linkType: 'playlist' }), false)
  assert.equal('title' in normalizeSearchHistoryEntry({ ...link, title: ' ' }), false)
  assert.equal('title' in normalizeSearchHistoryEntry({ ...link, title: 42 }), false)

  // The export writes one JSON record per line.
  const plain = normalizeSearchHistoryEntry({ _id: 'plain', query: 'daily news', lastUpdatedAt: 200, searchSettings: { time: 'today' } })
  const exported = [normalizeSearchHistoryEntry(link), plain].map(entry => JSON.stringify(entry)).join('\n')
  assert.deepEqual(exported.split('\n').map(line => parseExportedSearchHistoryEntry(JSON.parse(line))), [normalizeSearchHistoryEntry(link), plain])

  // A FreeTube record has no filters, link type, or title.
  assert.deepEqual(parseExportedSearchHistoryEntry({ _id: 'legacy query', lastUpdatedAt: 100 }), normalizeSearchHistoryEntry({ _id: 'legacy query', lastUpdatedAt: 100 }))
  assert.equal(parseExportedSearchHistoryEntry({ _id: 'no date' }), null)
  assert.equal(parseExportedSearchHistoryEntry(['not', 'a', 'record']), null)
})

test('suggests links by any part of their title as well as by the start of their link', () => {
  const link = { _id: 'link', query: 'https://youtu.be/abcdefghijk', linkType: 'video', title: 'Example Video' }
  const matches = text => searchHistoryEntryMatches(link, text, text.toLowerCase())

  assert.equal(matches('https://youtu'), true)
  assert.equal(matches('example vi'), true)
  assert.equal(matches('Video'), true)
  assert.equal(matches('youtu'), false)
  assert.equal(searchHistoryEntryMatches({ _id: 'daily news', query: 'Daily news' }, 'daily', 'daily'), false)
})
