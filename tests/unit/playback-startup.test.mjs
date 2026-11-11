import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  holdForPlaybackStartup,
  waitForBackgroundPlaybackTurn,
  waitForPlaybackStartup
} from '../../src/renderer/helpers/playbackStartup.js'

function settled(promise) {
  let done = false
  promise.then(() => { done = true })
  return () => new Promise(resolve => setImmediate(() => resolve(done)))
}

test('refreshes wait until every starting player releases its hold', async () => {
  const releaseFirst = holdForPlaybackStartup()
  const releaseSecond = holdForPlaybackStartup()
  const waited = settled(waitForPlaybackStartup())

  releaseFirst()
  assert.equal(await waited(), false)
  // The Watch page hands its hold to the mounting player in the same tick
  releaseSecond()
  const releasePlayer = holdForPlaybackStartup()
  assert.equal(await waited(), false)
  releasePlayer()
  assert.equal(await waited(), true)

  // A cancelled refresh doesn't wait for a player
  const releaseThird = holdForPlaybackStartup()
  const controller = new AbortController()
  const cancelled = settled(waitForPlaybackStartup(controller.signal))
  controller.abort()
  assert.equal(await cancelled(), true)
  releaseThird()
})

test('a player load that never settles stops holding refreshes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  holdForPlaybackStartup()
  const waited = settled(waitForPlaybackStartup())

  t.mock.timers.tick(14_999)
  assert.equal(await waited(), false)
  t.mock.timers.tick(1)
  assert.equal(await waited(), true)
})

// The turn passes on after the tick in which the Watch page hands its hold to the player
const afterHandoff = () => new Promise(resolve => setTimeout(resolve, 5))

/** Waits like a hidden Watch page, which holds once it starts loading */
function startHiddenTab(owner, signal = new AbortController().signal) {
  let release = null
  const started = waitForBackgroundPlaybackTurn(owner, signal).then(() => {
    if (!signal.aborted) release = holdForPlaybackStartup(owner)
  })
  return { started: settled(started), release: () => release?.() }
}

test('hidden tabs start their videos one at a time', async () => {
  const first = startHiddenTab('first')
  const shown = new AbortController()
  const second = startHiddenTab('second', shown.signal)
  const third = startHiddenTab('third')
  assert.equal(await first.started(), true)

  // The Watch page hands its hold to the mounting player in the same tick
  first.release()
  const releasePlayer = holdForPlaybackStartup('first')
  await afterHandoff()
  assert.equal(await third.started(), false)

  // A tab the user switches to stops waiting and leaves the queue
  shown.abort()
  assert.equal(await second.started(), true)
  assert.equal(await third.started(), false)

  releasePlayer()
  await afterHandoff()
  assert.equal(await third.started(), true)
  third.release()
  await afterHandoff()
})

test('a hidden tab that doesn\'t start loading passes its turn on', async () => {
  await waitForBackgroundPlaybackTurn('replaced', new AbortController().signal)
  const next = startHiddenTab('next')
  await afterHandoff()
  assert.equal(await next.started(), true)
  next.release()
  await afterHandoff()
})

test('a hidden tab whose video never settles stops holding the turn', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const slow = startHiddenTab('slow')
  assert.equal(await slow.started(), true)
  t.mock.timers.tick(0)
  const next = startHiddenTab('next')

  // Replacing the video doesn't restart the turn
  t.mock.timers.tick(10_000)
  const replacement = startHiddenTab('slow')
  assert.equal(await replacement.started(), true)

  t.mock.timers.tick(4_999)
  assert.equal(await next.started(), false)
  t.mock.timers.tick(1)
  assert.equal(await next.started(), true)
  replacement.release()
  next.release()
  t.mock.timers.tick(0)
})
