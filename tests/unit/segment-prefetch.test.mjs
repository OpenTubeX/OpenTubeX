import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_SEGMENT_PREFETCH_LIMIT,
  resolveSegmentPrefetchLimit
} from '../../src/renderer/helpers/player/segmentPrefetch.js'

test('SABR always falls back to sequential fetching', () => {
  // SABR requests depend on the state returned by the previous request,
  // so they can't be run in parallel
  assert.equal(resolveSegmentPrefetchLimit(8, true), DEFAULT_SEGMENT_PREFETCH_LIMIT)
})
