import assert from 'node:assert/strict'
import test from 'node:test'

import { getTranscriptPreScrollTop } from '../../src/renderer/components/WatchVideoTranscript/transcriptScroll.js'

test('limits the initial transcript animation to one viewport', () => {
  assert.equal(getTranscriptPreScrollTop(0, 10_000, 420), 9580)
  assert.equal(getTranscriptPreScrollTop(10_000, 0, 420), 420)
  assert.equal(getTranscriptPreScrollTop(0, 400, 420), 0)
})
