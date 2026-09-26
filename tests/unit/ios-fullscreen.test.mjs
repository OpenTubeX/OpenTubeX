import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
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

test('iOS fullscreen binding is restored once during player teardown', () => {
  const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
  const unmount = source.split('    onBeforeUnmount(() => {')
    .find(body => body.trimStart().startsWith('sponsorBlockRequestGeneration++'))
    .split('      clearTimeout(paidPromotionTimer)')[0]
  const destroy = source.split('    async function destroyPlayer() {')[1].split('      ignoreErrors = true')[0]
  let restores = 0
  const context = {
    iosFullscreenCleanup: () => { restores++ },
    sponsorBlockRequestGeneration: 0,
    screenWakeBinding: null,
    repeatStatsTracker: null,
    repeatStatsLoopObserver: null,
    clearSabrBackoffTimer() {},
  }

  vm.runInNewContext(`(() => { ${destroy} })()`, context)
  vm.runInNewContext(`(() => { ${unmount} })()`, context)
  assert.equal(restores, 1)
  assert.equal(context.iosFullscreenCleanup, null)
})
