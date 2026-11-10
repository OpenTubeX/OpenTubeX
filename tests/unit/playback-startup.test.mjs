import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holdForPlaybackStartup, waitForPlaybackStartup } from '../../src/renderer/helpers/playbackStartup.js'

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
