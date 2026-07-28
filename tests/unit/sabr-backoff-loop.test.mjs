import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_BACKOFFS_WITHOUT_PROGRESS,
  createBackoffLoopTracker
} from '../../src/renderer/helpers/player/sabrBackoffLoop.js'

const VOD = { backoffTimeMs: 2000, isLive: false, timeoutMs: 0 }

test('repeated backoffs without a segment escalate to a reload', () => {
  const tracker = createBackoffLoopTracker()
  const escalated = []

  for (let i = 0; i < MAX_BACKOFFS_WITHOUT_PROGRESS; i++) {
    escalated.push(tracker.record(VOD))
  }

  // Only the backoff that reaches the threshold asks for a reload; the earlier
  // ones are still an ordinary wait.
  assert.deepEqual(escalated, [false, false, true])
})

test('backoffs accumulate across separate requests', () => {
  // The regression this guards: the counters used to be rebuilt for every
  // network request, so the server handing out one short backoff per request
  // never reached the threshold and the loop was never broken. A single tracker
  // shared by the stream has to carry the count across those requests.
  const tracker = createBackoffLoopTracker()

  let escalated = false
  for (let request = 0; request < MAX_BACKOFFS_WITHOUT_PROGRESS; request++) {
    // Each iteration stands for a fresh shaka network request.
    escalated = tracker.record(VOD)
  }

  assert.equal(escalated, true)
})

test('a segment arriving clears the accumulated backoffs', () => {
  const tracker = createBackoffLoopTracker()

  for (let i = 0; i < MAX_BACKOFFS_WITHOUT_PROGRESS - 1; i++) {
    tracker.record(VOD)
  }
  tracker.reset()

  // A long video that hits an isolated backoff every so often keeps playing
  // rather than accumulating towards a spurious reload.
  for (let i = 0; i < MAX_BACKOFFS_WITHOUT_PROGRESS - 1; i++) {
    assert.equal(tracker.record(VOD), false)
  }
})

test('live streams are not escalated on count alone', () => {
  const tracker = createBackoffLoopTracker()

  for (let i = 0; i < MAX_BACKOFFS_WITHOUT_PROGRESS * 3; i++) {
    assert.equal(tracker.record({ backoffTimeMs: 2000, isLive: true, timeoutMs: 0 }), false)
  }
})

test('cumulative backoff time reaching the request timeout escalates', () => {
  const tracker = createBackoffLoopTracker()

  // Well under the count threshold, but the waiting has eaten the whole timeout.
  assert.equal(tracker.record({ backoffTimeMs: 5000, isLive: true, timeoutMs: 30_000 }), false)
  assert.equal(tracker.record({ backoffTimeMs: 20_000, isLive: true, timeoutMs: 30_000 }), true)
})
