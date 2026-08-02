import assert from 'node:assert/strict'
import test from 'node:test'

import { filterTranscriptSegments } from '../../src/renderer/components/WatchVideoTranscript/transcriptSearch.js'

const segments = [
  { index: 0, text: 'Hello this is just a' },
  { index: 1, text: 'test to demonstrate' },
  { index: 2, text: 'Another caption' }
]

test('returns every segment containing part of a cross-segment match', () => {
  assert.deepEqual(
    filterTranscriptSegments(segments, 'just a test'),
    segments.slice(0, 2)
  )
})

test('normalizes whitespace and case across segment boundaries', () => {
  assert.deepEqual(
    filterTranscriptSegments(segments, 'IS  JUST A\nTEST TO'),
    segments.slice(0, 2)
  )
})

test('keeps existing single-segment and empty-query behavior', () => {
  assert.deepEqual(filterTranscriptSegments(segments, 'another caption'), [segments[2]])
  assert.equal(filterTranscriptSegments(segments, '  '), segments)
})
