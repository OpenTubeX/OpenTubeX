import assert from 'node:assert/strict'
import { test } from 'node:test'

import { downloadFormats, filterCompletedDownloads } from '../../src/renderer/helpers/downloadFilters.js'

const now = new Date(2026, 8, 29, 12).getTime()
const downloads = [
  { id: 1, title: 'Morning mix', files: [{ title: 'Sunrise episode', author: 'Channel One', extension: 'MP4' }], completedAt: now - 1 * 86400000, sizeBytes: 500 },
  { id: 2, title: 'Evening mix', files: [{ author: 'Channel Two', path: '/music/track.webm' }], destinations: ['/music/track.webm'], completedAt: now - 40 * 86400000, sizeBytes: 100 },
  { id: 3, title: 'Legacy item', files: [{ author: 'Channel One' }], destinations: ['/music/track.mp3'], sizeBytes: 300 }
]
const options = { query: '', format: '', period: '', sort: 'date-desc' }

test('finds completed downloads by title or channel and format', () => {
  assert.deepEqual(downloadFormats(downloads[0]), ['mp4'])
  assert.deepEqual(filterCompletedDownloads(downloads, { ...options, query: 'channel one' }, now).map(item => item.id), [1, 3])
  assert.deepEqual(filterCompletedDownloads(downloads, { ...options, query: 'sunrise episode' }, now).map(item => item.id), [1])
  assert.deepEqual(filterCompletedDownloads(downloads, { ...options, query: ' EVENING ' }, now).map(item => item.id), [2])
  assert.deepEqual(filterCompletedDownloads(downloads, { ...options, format: 'webm' }, now).map(item => item.id), [2])
})

test('filters by completion date and sorts by date or size', () => {
  assert.deepEqual(filterCompletedDownloads(downloads, { ...options, period: 'week' }, now).map(item => item.id), [1])
  assert.deepEqual(filterCompletedDownloads(downloads, { ...options, period: 'month' }, now).map(item => item.id), [1])
  assert.deepEqual(filterCompletedDownloads(downloads, { ...options, period: 'year' }, now).map(item => item.id), [1, 2])
  assert.deepEqual(filterCompletedDownloads(downloads, { ...options, sort: 'date-asc' }, now).map(item => item.id), [2, 1, 3])
  assert.deepEqual(filterCompletedDownloads(downloads, { ...options, sort: 'size-asc' }, now).map(item => item.id), [2, 3, 1])
  assert.deepEqual(filterCompletedDownloads(downloads, { ...options, sort: 'size-desc' }, now).map(item => item.id), [1, 3, 2])
})
