import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isReplaySeek,
  parseReplayOffsetMs,
  shouldPrefetchReplay,
  takeDueReplayComments,
} from '../../src/renderer/components/WatchVideoLiveChat/liveChatReplay.js'

test('reads the player position a replay action belongs to', () => {
  assert.equal(parseReplayOffsetMs('90000'), 90_000)
  assert.equal(parseReplayOffsetMs('0'), 0)
})

test('falls back to the start of the video for unusable replay offsets', () => {
  assert.equal(parseReplayOffsetMs(undefined), 0)
  assert.equal(parseReplayOffsetMs(''), 0)
  assert.equal(parseReplayOffsetMs('not a number'), 0)
  // Messages sent before the stream went live carry a negative offset.
  assert.equal(parseReplayOffsetMs('-4000'), 0)
})

test('treats small forward steps as playback rather than as a seek', () => {
  assert.equal(isReplaySeek(0, 0), false)
  assert.equal(isReplaySeek(10, 10.25), false)
  assert.equal(isReplaySeek(10, 15), false)
})

test('treats jumps in either direction as a seek', () => {
  assert.equal(isReplaySeek(10, 15.5), true)
  assert.equal(isReplaySeek(3600, 60), true)
  // Restarting a finished video seeks back to the beginning.
  assert.equal(isReplaySeek(600, 0), true)
})

test('shows only the buffered messages the player has reached', () => {
  const pending = [
    { offsetMs: 1000, comment: 'a' },
    { offsetMs: 2000, comment: 'b' },
    { offsetMs: 9000, comment: 'c' },
  ]

  assert.deepEqual(takeDueReplayComments(pending, 2), [
    { offsetMs: 1000, comment: 'a' },
    { offsetMs: 2000, comment: 'b' },
  ])
  assert.deepEqual(pending, [{ offsetMs: 9000, comment: 'c' }])

  assert.deepEqual(takeDueReplayComments(pending, 2), [])
  assert.deepEqual(pending, [{ offsetMs: 9000, comment: 'c' }])

  assert.deepEqual(takeDueReplayComments(pending, 30), [{ offsetMs: 9000, comment: 'c' }])
  assert.deepEqual(pending, [])
  assert.deepEqual(takeDueReplayComments(pending, 30), [])
})

test('keeps fetching while the replay does not reach far enough ahead of the player', () => {
  assert.equal(shouldPrefetchReplay(0, 0), true)
  assert.equal(shouldPrefetchReplay(19_000, 0), true)
  assert.equal(shouldPrefetchReplay(20_000, 0), false)

  // A quiet stretch of the stream leaves nothing pending, but the replay has
  // still been fetched past the player, so it must not be refetched.
  assert.equal(shouldPrefetchReplay(3_600_000, 3000), false)

  // Seeking ahead of everything fetched so far has to refill the buffer.
  assert.equal(shouldPrefetchReplay(60_000, 3000), true)
})
