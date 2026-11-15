import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resumePendingDownload,
  updatePendingDownloadStatuses,
} from '../../src/main/downloadQueue.js'

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
