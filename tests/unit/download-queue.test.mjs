import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareQueuedDownloads,
  normalizeDownloadBandwidth,
  normalizeDownloadConcurrency,
  resumePendingDownload,
  updatePendingDownloadStatuses,
} from '../../src/main/downloadQueue.js'

test('normalizes download queue limits', () => {
  assert.equal(normalizeDownloadConcurrency('4'), 4)
  assert.equal(normalizeDownloadConcurrency('0'), 1)
  assert.equal(normalizeDownloadConcurrency('99'), 10)
  assert.equal(normalizeDownloadConcurrency('invalid'), 2)
  assert.equal(normalizeDownloadBandwidth('2048'), 2048)
  assert.equal(normalizeDownloadBandwidth('-1'), 0)
})

test('sorts queued downloads by position', () => {
  const downloads = [
    { id: 1, queuePosition: 2 },
    { id: 2, queuePosition: 1 },
    { id: 3, queuePosition: 3 },
    { id: 4, queuePosition: 1 },
  ]
  assert.deepEqual(downloads.sort(compareQueuedDownloads).map(download => download.id), [2, 4, 1, 3])
})

test('updates only pending download statuses when pausing and resuming the queue', () => {
  const records = new Map([
    [1, { id: 1, status: 'queued' }],
    [2, { id: 2, status: 'paused' }],
    [3, { id: 3, status: 'completed' }],
  ])
  const pendingIds = [1, 2, 3]

  assert.deepEqual(updatePendingDownloadStatuses(records, pendingIds, 'paused'), [records.get(1)])
  assert.equal(records.get(1).status, 'paused')
  assert.equal(records.get(3).status, 'completed')

  assert.deepEqual(updatePendingDownloadStatuses(records, pendingIds, 'queued'), [records.get(1), records.get(2)])
  assert.equal(records.get(1).status, 'queued')
  assert.equal(records.get(2).status, 'queued')
  assert.equal(records.get(3).status, 'completed')
})

test('preserves an individual resume when a restarted download joins a paused queue', () => {
  const record = { id: 5, status: 'paused' }
  const individuallyResumedIds = new Set()

  assert.equal(resumePendingDownload(record, individuallyResumedIds, true), true)
  assert.equal(record.status, 'queued')
  assert.deepEqual([...individuallyResumedIds], [record.id])
})
