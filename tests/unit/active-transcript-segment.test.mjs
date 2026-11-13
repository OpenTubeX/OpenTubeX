import assert from 'node:assert/strict'
import test from 'node:test'

import { findActiveTranscriptSegmentIndex } from '../../src/renderer/components/WatchVideoTranscript/activeTranscriptSegment.js'

const segments = [
  { index: 0, start: 0, end: 10, activeUntil: 10 },
  { index: 1, start: 4, end: 5, activeUntil: 10 },
  { index: 2, start: 12, end: 13, activeUntil: 13 }
]

test('falls back to an earlier overlapping cue when the latest cue has ended', () => {
  assert.equal(findActiveTranscriptSegmentIndex(segments, 4.5), 1)
  assert.equal(findActiveTranscriptSegmentIndex(segments, 6), 0)
})

test('returns no cue in transcript gaps or outside its range', () => {
  assert.equal(findActiveTranscriptSegmentIndex([], 0), -1)
  assert.equal(findActiveTranscriptSegmentIndex(segments, -1), -1)
  assert.equal(findActiveTranscriptSegmentIndex(segments, 11), -1)
  assert.equal(findActiveTranscriptSegmentIndex(segments, 13), -1)
})

test('checks earlier overlapping cues when activeUntil is missing', () => {
  const legacySegments = [
    { index: 0, start: 0, end: 10 },
    { index: 1, start: 4, end: 5 },
  ]

  assert.equal(findActiveTranscriptSegmentIndex(legacySegments, 6), 0)
})
