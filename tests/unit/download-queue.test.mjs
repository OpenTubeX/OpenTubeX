import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareQueuedDownloads,
  normalizeDownloadBandwidth,
  normalizeDownloadConcurrency,
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
