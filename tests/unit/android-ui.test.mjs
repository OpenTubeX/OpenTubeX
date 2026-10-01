import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { shouldShowAndroidStatusBar } from '../../src/renderer/helpers/androidUi.js'
import { shouldRotateFullscreenToLandscape } from '../../src/renderer/helpers/capacitorUi.js'

test('fullscreen landscape videos request landscape display orientation', () => {
  assert.equal(shouldRotateFullscreenToLandscape(true, { videoWidth: 1920, videoHeight: 1080 }), true)
})

test('fullscreen orientation rotation can be disabled on mobile', () => {
  assert.equal(
    shouldRotateFullscreenToLandscape(true, { videoWidth: 1920, videoHeight: 1080 }, false),
    false
  )
})

test('portrait, square, unknown, and inline videos keep the user display orientation', () => {
  assert.equal(shouldRotateFullscreenToLandscape(true, { videoWidth: 1080, videoHeight: 1920 }), false)
  assert.equal(shouldRotateFullscreenToLandscape(true, { videoWidth: 1080, videoHeight: 1080 }), false)
  assert.equal(shouldRotateFullscreenToLandscape(true, { videoWidth: 0, videoHeight: 0 }), false)
  assert.equal(shouldRotateFullscreenToLandscape(false, { videoWidth: 1920, videoHeight: 1080 }), false)
})

test('fullscreen uses metadata until the video reports its own dimensions', () => {
  assert.equal(shouldRotateFullscreenToLandscape(true, { videoWidth: 0, videoHeight: 0 }, true, 16 / 9), true)
  assert.equal(shouldRotateFullscreenToLandscape(true, { videoWidth: 0, videoHeight: 0 }, true, 9 / 16), false)
  assert.equal(shouldRotateFullscreenToLandscape(true, { videoWidth: 1080, videoHeight: 1920 }, true, 16 / 9), false)
})

test('fullscreen hides the Android status bar only while player controls are hidden', () => {
  assert.equal(shouldShowAndroidStatusBar({ active: true, fullscreen: true, controlsShown: false }), false)
  assert.equal(shouldShowAndroidStatusBar({ active: true, fullscreen: true, controlsShown: true }), true)
  assert.equal(shouldShowAndroidStatusBar({ active: true, fullscreen: false, controlsShown: false }), true)
  assert.equal(shouldShowAndroidStatusBar({ active: false, fullscreen: true, controlsShown: false }), true)
})

test('Android fullscreen observes display rotation without subscribing to the physical sensor', async () => {
  const source = readFileSync(new URL('../../src/renderer/helpers/androidUi.js', import.meta.url), 'utf8')
  const start = source.indexOf('function createAndroidRotationObserver(')
  const end = source.indexOf('\nfunction videoDimensions(', start)
  assert.ok(start !== -1 && end !== -1)

  let emit
  let removed = false
  const ScreenOrientation = {
    addListener: async (event, callback) => {
      assert.equal(event, 'screenOrientationChange')
      emit = callback
      return { remove: async () => { removed = true } }
    },
  }
  const { observeAndroidDisplayRotation } = vm.runInNewContext(
    `${source.slice(start, end).replace(/^export /gm, '')}\n;({ observeAndroidDisplayRotation })`,
    { AndroidUi: { addListener: () => assert.fail('Physical sensing bypasses the system rotation lock') }, ScreenOrientation, console, Set, Promise }
  )
  const received = []
  const stop = observeAndroidDisplayRotation(landscape => received.push(landscape))
  await new Promise(resolve => setImmediate(resolve))
  emit({ type: 'landscape-primary' })
  emit({ type: 'portrait-primary' })
  assert.deepEqual(received, [true, false])
  stop()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(removed, true)
})

test('Android physical rotation sensing starts only for explicit subscribers and stops after the last one', async () => {
  const source = readFileSync(new URL('../../src/renderer/helpers/androidUi.js', import.meta.url), 'utf8')
  const start = source.indexOf('function createAndroidRotationObserver(')
  const end = source.indexOf('\nfunction videoDimensions(', start)
  assert.ok(start !== -1 && end !== -1)
  const calls = []
  let emit
  const AndroidUi = {
    addListener: async (event, callback) => {
      assert.equal(event, 'deviceRotationChange')
      emit = callback
      return { remove: async () => { calls.push('remove') } }
    },
    setDeviceRotationEnabled: async ({ enabled }) => { calls.push(enabled) },
  }
  const { observeAndroidDeviceRotation } = vm.runInNewContext(
    `${source.slice(start, end).replace(/^export /gm, '')}\n;({ observeAndroidDeviceRotation })`,
    { AndroidUi, ScreenOrientation: {}, console, Set, Promise }
  )
  const received = []
  assert.deepEqual(calls, [])
  const stop = observeAndroidDeviceRotation(landscape => received.push(landscape))
  const stopSecond = observeAndroidDeviceRotation(() => {})
  await new Promise(resolve => setImmediate(resolve))
  emit({ landscape: true })
  emit({ landscape: false })
  assert.deepEqual(received, [true, false])
  assert.deepEqual(calls, [true])
  stop()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [true])
  stopSecond()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [true, false, 'remove'])
})
