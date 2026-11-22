import assert from 'node:assert/strict'
import test from 'node:test'
import { filterHistoryByDateAndChannel, getHistoryChannels, parseHistoryDate } from '../../src/renderer/helpers/historyBrowse.js'
import { filterVideosWithQuery } from '../../src/renderer/helpers/historySearch.js'

const entries = [
  { title: 'Night walk', author: 'Example', authorId: 'UC1', timeWatched: new Date(2026, 9, 13, 23, 59, 59, 999).getTime() },
  { title: 'City tour', author: 'Example', authorId: 'UC2', timeWatched: new Date(2026, 9, 13).getTime() },
  { title: 'City walk', author: 'Old name', authorId: 'UC1', timeWatched: new Date(2026, 9, 12, 12).getTime() },
  { title: 'Imported walk', author: 'Imported', timeWatched: new Date(2026, 9, 11).getTime() },
  { title: 'Missing metadata' },
]

test('date bounds include whole local days and preserve history order', () => {
  assert.deepEqual(filterHistoryByDateAndChannel(entries, { fromDate: '2026-10-13', toDate: '2026-10-13' }), entries.slice(0, 2))
  assert.deepEqual(filterHistoryByDateAndChannel(entries, { fromDate: '2026-10-12' }), entries.slice(0, 3))
  assert.deepEqual(filterHistoryByDateAndChannel(entries, { toDate: '2026-10-12' }), entries.slice(2, 4))
  assert.deepEqual(filterHistoryByDateAndChannel(entries), entries)
  assert.deepEqual(filterHistoryByDateAndChannel(entries, { fromDate: '2026-10-14', toDate: '2026-10-12' }), [])
})

test('channels use IDs across name changes and fall back to names for imported entries', () => {
  assert.deepEqual(filterHistoryByDateAndChannel(entries, { channel: 'id:UC1' }), [entries[0], entries[2]])
  assert.deepEqual(filterHistoryByDateAndChannel(entries, { channel: 'name:Imported' }), [entries[3]])
  assert.deepEqual(getHistoryChannels(entries, 'en-US'), [
    { value: 'id:UC1', name: 'Example (UC1)' },
    { value: 'id:UC2', name: 'Example (UC2)' },
    { value: 'name:Imported', name: 'Imported' },
  ])
  assert.deepEqual(filterHistoryByDateAndChannel(entries, { channel: 'id:removed' }), [])
})

test('ID-less records join an unambiguous channel across name changes', () => {
  const records = [
    { author: 'Current name', authorId: 'UC1', timeWatched: new Date(2026, 9, 14).getTime() },
    { author: 'Current name', timeWatched: new Date(2026, 9, 12).getTime() },
    { author: 'Old name', authorId: 'UC1', timeWatched: new Date(2026, 9, 12).getTime() },
    { author: 'Old name', timeWatched: new Date(2026, 9, 11).getTime() },
    { author: 'Imported channel' },
  ]
  assert.deepEqual(getHistoryChannels(records, 'en-US'), [
    { value: 'id:UC1', name: 'Current name' },
    { value: 'name:Imported channel', name: 'Imported channel' },
  ])
  assert.deepEqual(filterHistoryByDateAndChannel(records, { channel: 'id:UC1' }), records.slice(0, 4))
  assert.deepEqual(filterHistoryByDateAndChannel(records, { channel: 'id:UC1', toDate: '2026-10-12' }), records.slice(1, 4))
})

test('ambiguous names never associate ID-less records with either known channel', () => {
  const records = [
    { author: 'Shared name', authorId: 'UC1' },
    { author: 'Shared name', authorId: 'UC2' },
    { author: 'Shared name' },
    { author: 'Shared name', authorId: 'UC1' },
  ]
  assert.deepEqual(getHistoryChannels(records, 'en-US'), [
    { value: 'name:Shared name', name: 'Shared name' },
    { value: 'id:UC1', name: 'Shared name (UC1)' },
    { value: 'id:UC2', name: 'Shared name (UC2)' },
  ])
  assert.deepEqual(filterHistoryByDateAndChannel(records, { channel: 'id:UC1' }), [records[0], records[3]])
  assert.deepEqual(filterHistoryByDateAndChannel(records, { channel: 'id:UC2' }), [records[1]])
  assert.deepEqual(filterHistoryByDateAndChannel(records, { channel: 'name:Shared name' }), [records[2]])
})

test('date, channel and existing text search compose', () => {
  const filtered = filterHistoryByDateAndChannel(entries, { fromDate: '2026-10-12', channel: 'id:UC1' })
  assert.deepEqual(filterVideosWithQuery(filtered, 'city walk'), [entries[2]])
})

test('route dates reject arrays, impossible dates and malformed values', () => {
  for (const value of [undefined, ['2026-10-13'], '', '2026-2-1', '2026-02-30', '2026-13-01', 'invalid']) {
    assert.equal(parseHistoryDate(value), null)
  }
  assert.equal(parseHistoryDate('2024-02-29').getDate(), 29)
})

test('inclusive end dates respect daylight-saving transitions', () => {
  const originalTimezone = process.env.TZ
  process.env.TZ = 'Europe/Berlin'
  try {
    for (const [month, day] of [[2, 29], [9, 25]]) {
      const date = `2026-${String(month + 1).padStart(2, '0')}-${day}`
      const videos = [
        { timeWatched: new Date(2026, month, day, 0).getTime() },
        { timeWatched: new Date(2026, month, day, 23, 59, 59, 999).getTime() },
        { timeWatched: new Date(2026, month, day + 1, 0).getTime() },
      ]
      assert.deepEqual(filterHistoryByDateAndChannel(videos, { fromDate: date, toDate: date }), videos.slice(0, 2))
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  }
})

test('a midnight daylight-saving gap does not include the next day', () => {
  const originalTimezone = process.env.TZ
  process.env.TZ = 'America/Sao_Paulo'
  try {
    const videos = [
      { timeWatched: new Date(2018, 10, 4, 1).getTime() },
      { timeWatched: new Date(2018, 10, 4, 23, 59, 59, 999).getTime() },
      { timeWatched: new Date(2018, 10, 5, 0).getTime() },
      { timeWatched: new Date(2018, 10, 5, 0, 30).getTime() },
    ]
    assert.deepEqual(filterHistoryByDateAndChannel(videos, { fromDate: '2018-11-04', toDate: '2018-11-04' }), videos.slice(0, 2))
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  }
})
