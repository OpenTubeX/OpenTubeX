import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bindAndroidFullscreen } from '../../src/renderer/helpers/player/androidFullscreen.js'

for (const rejected of [false, true]) {
  test(`Android waits for its snapshot guard before requesting rotation and fullscreen (${rejected ? 'rejected' : 'success'})`, async () => {
    const calls = []
    let enabled = false
    let acknowledge
    let finishFullscreen
    const rotation = new Promise(resolve => { acknowledge = resolve })
    const fullscreen = new Promise(resolve => { finishFullscreen = resolve })
    const original = async () => {
      calls.push('fullscreen')
      await fullscreen
      enabled = !rejected
    }
    const controls = Object.create({ toggleFullScreen: original, compiledToggle: original })
    controls.isFullScreenEnabled = () => enabled
    const cleanup = bindAndroidFullscreen(controls, {
      isActive: () => true,
      async prepareEnter() { calls.push('guard'); await rotation; calls.push('rotate') },
      finishEnter: success => calls.push(['finished', success]),
    })
    const entry = controls.compiledToggle()
    const duplicate = controls.toggleFullScreen()
    assert.deepEqual(calls, ['guard'], 'Protect the intact page before either rotation or fullscreen starts')
    acknowledge()
    finishFullscreen()
    await Promise.all([entry, duplicate])
    assert.deepEqual(calls, ['guard', 'rotate', 'fullscreen', ['finished', !rejected]])
    if (enabled) {
      await controls.toggleFullScreen()
      assert.equal(calls.filter(c => c === 'rotate').length, 1)
    }
    cleanup()
    assert.equal(controls.toggleFullScreen, original)
    assert.equal(controls.compiledToggle, original)
  })
}

test('Android rejects inactive entry and tolerates an unavailable rotation preference', async () => {
  let active = false
  let fullscreen = false
  const controls = { isFullScreenEnabled: () => fullscreen, async toggleFullScreen() { fullscreen = true } }
  const cleanup = bindAndroidFullscreen(controls, {
    isActive: () => active,
    prepareEnter: () => Promise.reject(new Error('Orientation unavailable')),
    finishEnter: entered => assert.equal(entered, true),
  })
  await controls.toggleFullScreen()
  assert.equal(fullscreen, false)
  active = true
  await controls.toggleFullScreen()
  assert.equal(fullscreen, true)
  cleanup()
})
