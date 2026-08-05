import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createCoalescingPoller,
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

test('runs one poll at a time', async () => {
  let running = 0
  let overlapped = false
  let calls = 0

  const poll = createCoalescingPoller(async () => {
    calls++
    running++
    overlapped ||= running > 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    running--
  })

  await Promise.all([poll(), poll(), poll()])

  assert.equal(overlapped, false)
  // The two requests made while the first was running collapse into one re-run.
  assert.equal(calls, 2)
})

test('re-runs a poll that was requested while one was already in flight', async () => {
  // The scenario this exists for: a poll is in flight, the player seeks, the seek
  // discards that poll's response, and the request that follows it is the only thing
  // left that would fetch the new position.
  const positions = []
  let currentPosition = 0
  let releaseFirst

  const poll = createCoalescingPoller(async () => {
    const position = currentPosition
    if (position === 0) {
      await new Promise((resolve) => { releaseFirst = resolve })
    }
    positions.push(position)
  })

  poll()
  await Promise.resolve()

  // Seek while that first poll is still in flight.
  currentPosition = 3600
  poll()

  releaseFirst()
  await new Promise((resolve) => setTimeout(resolve, 0))

  // Without the re-run the chat would sit empty at 3600 until playback resumed.
  assert.deepEqual(positions, [0, 3600])
})

test('stops re-running once nothing further was requested', async () => {
  let calls = 0
  const poll = createCoalescingPoller(async () => { calls++ })

  await poll()
  assert.equal(calls, 1)

  await poll()
  assert.equal(calls, 2)
})

test('a failing poll does not wedge the poller', async () => {
  let calls = 0
  const poll = createCoalescingPoller(async () => {
    calls++
    throw new Error('network down')
  })

  await assert.rejects(poll(), /network down/)
  // The in-flight flag has to be released, or nothing would ever poll again.
  await assert.rejects(poll(), /network down/)
  assert.equal(calls, 2)
})
