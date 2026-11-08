import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_SEGMENT_PREFETCH_LIMIT,
  MAX_SEGMENT_PREFETCH_LIMIT,
  resolveSegmentPrefetchLimit
} from '../../src/renderer/helpers/player/segmentPrefetch.js'

test('the configured limit is used for non-SABR playback', () => {
  assert.equal(resolveSegmentPrefetchLimit(4, false), 4)
  assert.equal(resolveSegmentPrefetchLimit(MAX_SEGMENT_PREFETCH_LIMIT, false), MAX_SEGMENT_PREFETCH_LIMIT)
})

test('SABR always falls back to sequential fetching', () => {
  // SABR requests depend on the state returned by the previous request,
  // so they can't be run in parallel
  assert.equal(resolveSegmentPrefetchLimit(8, true), DEFAULT_SEGMENT_PREFETCH_LIMIT)
})

test('the configured limit is clamped to the supported range', () => {
  assert.equal(resolveSegmentPrefetchLimit(0, false), DEFAULT_SEGMENT_PREFETCH_LIMIT)
  assert.equal(resolveSegmentPrefetchLimit(-5, false), DEFAULT_SEGMENT_PREFETCH_LIMIT)
  assert.equal(resolveSegmentPrefetchLimit(1000, false), MAX_SEGMENT_PREFETCH_LIMIT)
  assert.equal(resolveSegmentPrefetchLimit(3.9, false), 3)
})

test('unusable values fall back to the default', () => {
  assert.equal(resolveSegmentPrefetchLimit(undefined, false), DEFAULT_SEGMENT_PREFETCH_LIMIT)
  assert.equal(resolveSegmentPrefetchLimit(NaN, false), DEFAULT_SEGMENT_PREFETCH_LIMIT)
  assert.equal(resolveSegmentPrefetchLimit(Infinity, false), DEFAULT_SEGMENT_PREFETCH_LIMIT)
})
