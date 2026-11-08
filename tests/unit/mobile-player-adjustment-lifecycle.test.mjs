import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { test } from 'node:test'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import { isAppHidden, setAndroidAppVisible } from '../../src/renderer/helpers/appVisibility.js'
import { createMobilePlayerAdjustments } from '../../src/renderer/helpers/mobilePlayerAdjustments.js'

const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const visibilityState = source.match(/const mobileAdjustmentsVisible = ref\([^\n]+/)?.[0]
assert.ok(visibilityState)
const start = source.indexOf('    const mobileFullscreenBrightnessActive =')
const lifecycle = `${visibilityState}\n${source.slice(start, source.indexOf('\n    watch(scrollMiniPlayerDetached', start))}`

test('fullscreen brightness follows Android visibility when Chromium remains visible', async t => {
  const previousDocument = globalThis.document
  const document = Object.assign(new EventTarget(), { hidden: false })
  globalThis.document = document
  setAndroidAppVisible(true)
  const unmount = []
  const scope = effectScope()
  t.after(() => {
    unmount.forEach(callback => callback())
    scope.stop()
    setAndroidAppVisible(null)
    globalThis.document = previousDocument
  })
  let brightness = 0.3
  const mobileAdjustments = createMobilePlayerAdjustments({
    read: async () => brightness,
    write: async (action, value) => { brightness = value },
    onChange() {},
    onError: error => { throw error },
  })
  const isFullscreen = ref(false)
  const miniPlayerActive = ref(false)
  const dismissing = ref(false)
  const props = reactive({ videoId: 'test' })
  const resets = []
  scope.run(() => vm.runInNewContext(lifecycle, {
    ref, computed, watch, document, isAppHidden,
    process: { env: { IS_CAPACITOR: true } },
    isActiveTab: ref(true), scrollMiniPlayerActive: miniPlayerActive, scrollMiniPlayerDragStyle: ref(null), isFullscreen,
    mobileMiniPlayerDismissSettling: dismissing, props,
    store: { getters: { getMobileFullscreenBrightness: true } },
    mobileAdjustments,
    resetMobileAdjustments: preserve => { resets.push(preserve); mobileAdjustments.reset() },
    cancelMobileFullscreenGesture() {},
    onMounted: callback => callback(),
    onBeforeUnmount: callback => unmount.push(callback),
  }))
  isFullscreen.value = true
  await nextTick()
  await mobileAdjustments.settled()
  assert.equal(brightness, 1)
  setAndroidAppVisible(false)
  await nextTick()
  await mobileAdjustments.settled()
  assert.equal(document.hidden, false)
  assert.equal(brightness, 0.3, 'Home restores brightness even when Chromium is still visible')
  setAndroidAppVisible(true)
  await nextTick()
  await mobileAdjustments.settled()
  assert.equal(brightness, 1, 'returning to fullscreen reapplies the preference')
  isFullscreen.value = false
  miniPlayerActive.value = true
  dismissing.value = true
  await nextTick()
  setAndroidAppVisible(false)
  await nextTick()
  assert.equal(resets.at(-1), true, 'hiding preserves a committed dismissal')
  setAndroidAppVisible(true)
  await nextTick()
  assert.equal(resets.at(-1), true, 'returning preserves the same pending close')
  props.videoId = 'replacement'
  await nextTick()
  assert.equal(resets.at(-1), false, 'changing video cancels the pending close')
})
