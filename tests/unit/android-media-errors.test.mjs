import assert from 'node:assert/strict'
import test from 'node:test'
import { bindAndroidMediaErrors } from '../../src/renderer/helpers/player/androidMediaErrors.js'

function fixture() {
  const video = new EventTarget()
  video.error = null
  const cleanup = bindAndroidMediaErrors(video)
  const errors = []
  // Shaka's pending source load rejects on every delivered error event,
  // including events without an active MediaError.
  video.addEventListener('error', () => errors.push(video.error))
  return { video, errors, cleanup }
}

test('a stale media error does not abort the replacement source load', () => {
  const { video, errors } = fixture()
  video.dispatchEvent(new Event('error'))
  assert.deepEqual(errors, [])
  let loaded = false
  video.addEventListener('loadedmetadata', () => { loaded = true })
  video.dispatchEvent(new Event('loadedmetadata'))
  assert.equal(loaded, true)
})

test('real media errors still reach the pending source load', () => {
  const { video, errors } = fixture()
  for (const code of [1, 2, 3, 4]) {
    video.error = { code, message: `media error ${code}` }
    video.dispatchEvent(new Event('error'))
    assert.equal(errors.at(-1), video.error)
  }
  assert.equal(errors.length, 4)
})

test('unbinding restores normal error dispatch', () => {
  const { video, errors, cleanup } = fixture()
  cleanup()
  video.dispatchEvent(new Event('error'))
  assert.deepEqual(errors, [null])
})
