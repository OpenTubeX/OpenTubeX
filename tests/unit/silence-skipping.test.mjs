import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createRequestPresentationTracker,
  releaseAnalysisSegmentsBefore
} from '../../src/renderer/components/ft-shaka-video-player/opentubex/useSilenceSkipping.js'

test('rejects late responses from an earlier presentation', () => {
  const tracker = createRequestPresentationTracker()
  const previousRequest = {}
  const currentRequest = {}

  tracker.beginRequest(previousRequest)
  tracker.reset()
  tracker.beginRequest(currentRequest)

  assert.equal(tracker.isCurrent(previousRequest), false)
  assert.equal(tracker.isCurrent(currentRequest), true)
})

test('does not relabel a retried request after the presentation changes', () => {
  const tracker = createRequestPresentationTracker()
  const retriedRequest = {}

  tracker.beginRequest(retriedRequest)
  tracker.reset()
  tracker.beginRequest(retriedRequest)

  assert.equal(tracker.isCurrent(retriedRequest), false)
})

test('allows evicted analysis segments to be queued again after a backward seek', () => {
  const initSegment = { end: Number.NEGATIVE_INFINITY, key: 'init' }
  const evictedSegment = { end: 20, key: 'old' }
  const retainedSegment = { end: 50, key: 'current' }
  const analysisSegments = new Map([
    [initSegment.key, initSegment],
    [evictedSegment.key, evictedSegment],
    [retainedSegment.key, retainedSegment]
  ])
  const appendQueue = [evictedSegment, retainedSegment]

  releaseAnalysisSegmentsBefore(analysisSegments, appendQueue, 30)

  assert.deepEqual([...analysisSegments.keys()], ['init', 'current'])
  assert.deepEqual(appendQueue, [retainedSegment])
})
