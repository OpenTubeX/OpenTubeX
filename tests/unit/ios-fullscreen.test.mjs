import assert from 'node:assert/strict'
import test from 'node:test'
import { bindIosFullscreen } from '../../src/renderer/helpers/player/iosFullscreen.js'

test('iOS fullscreen stays app-owned for swipes, dock scrolling and keyboard input', async () => {
  let enabled = false
  const browserToggle = () => { throw new Error('Cannot request fullscreen without transient activation') }
  const prototype = { toggleFullScreen: browserToggle, compiledToggle: browserToggle, isFullScreenEnabled: () => false, isFullScreenSupported: () => false }
  const controls = Object.create(prototype)
  const restore = bindIosFullscreen(controls, { isEnabled: () => enabled, setEnabled: value => { enabled = value } })
  assert.equal(controls.isFullScreenSupported(), true)
  for (let i = 0; i < 3; i++) {
    await controls.compiledToggle()
    assert.equal(enabled, true)
    assert.equal(controls.isFullScreenEnabled(), true)
    // Browser focus/fullscreen events cannot change the app's presentation.
    assert.equal(prototype.isFullScreenEnabled(), false)
    assert.equal(controls.isFullScreenEnabled(), true)
    await controls.toggleFullScreen()
    assert.equal(enabled, false)
  }
  restore()
  assert.equal(controls.toggleFullScreen, browserToggle)
  assert.equal(controls.compiledToggle, browserToggle)
})

test('iOS rotation toggles the app full window instead of WebKit fullscreen', () => {
  let enabled = false
  let canRotate = true
  const orientation = new EventTarget()
  orientation.type = 'portrait-primary'
  const rotate = type => {
    orientation.type = type
    orientation.dispatchEvent(new Event('change'))
  }
  const restore = bindIosFullscreen(Object.create({}), {
    isEnabled: () => enabled,
    setEnabled: value => { enabled = value },
    canRotate: () => canRotate,
    orientation,
  })
  rotate('landscape-primary')
  assert.equal(enabled, true)
  rotate('portrait-primary')
  assert.equal(enabled, false)
  canRotate = false
  rotate('landscape-secondary')
  assert.equal(enabled, false)
  canRotate = true
  restore()
  rotate('landscape-primary')
  assert.equal(enabled, false)
})
