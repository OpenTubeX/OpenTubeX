import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const resizedSource = source.slice(source.indexOf('    function resized(entries) {'), source.indexOf('    // Remeasure the control bar'))

for (const [active, animating] of [[true, false], [true, true], [false, true]]) {
  test(`mini-player resize preserves the inline controls with active=${active}, animating=${animating}`, () => {
    const onlyUseOverFlowMenu = { value: false }
    vm.runInNewContext(`${resizedSource}; resized([{ contentBoxSize: [{ inlineSize: 360 }] }])`, {
      onlyUseOverFlowMenu,
      scrollMiniPlayerActive: { value: active },
      scrollMiniPlayerAnimating: { value: animating },
      scrollMiniPlayerDragStyle: { value: null },
      USE_OVERFLOW_MENU_WIDTH_THRESHOLD: 634,
      rememberInlinePlayerLayoutHeight() {},
      repairScrollMiniPlaceholderHeight() {},
    })
    assert.equal(onlyUseOverFlowMenu.value, false)
  })
}

test('a settled inline player still adapts its controls to the actual width', () => {
  const onlyUseOverFlowMenu = { value: false }
  const resized = vm.runInNewContext(`${resizedSource}; resized`, {
    onlyUseOverFlowMenu,
    scrollMiniPlayerActive: { value: false },
    scrollMiniPlayerAnimating: { value: false },
    scrollMiniPlayerDragStyle: { value: null },
    USE_OVERFLOW_MENU_WIDTH_THRESHOLD: 634,
    rememberInlinePlayerLayoutHeight() {},
    repairScrollMiniPlaceholderHeight() {},
  })
  for (const [width, expected] of [[633.75, true], [0, true], [634.25, false]]) {
    resized([{ contentBoxSize: [{ inlineSize: width }] }])
    assert.equal(onlyUseOverFlowMenu.value, expected)
  }
})

test('swipe previews defer hidden control layout until the inline player settles', () => {
  const sourceStart = source.indexOf('    function scheduleControlPanelLayout(')
  const sourceEnd = source.indexOf('    function setupAdaptiveControlPanelLayout(', sourceStart)
  let frames = 0
  let layouts = 0
  const scrollMiniPlayerDragStyle = { value: {} }
  let queued
  const schedule = vm.runInNewContext(`${source.slice(sourceStart, sourceEnd)}\nscheduleControlPanelLayout`, {
    isActiveTab: { value: true },
    scrollMiniPlayerActive: { value: false },
    scrollMiniPlayerAnimating: { value: false },
    scrollMiniPlayerDragStyle,
    controlPanelLayoutFrame: null,
    requestAnimationFrame(callback) { frames++; queued = callback; return frames },
    cancelAnimationFrame() {},
    updateControlPanelLayout() { layouts++ },
  })
  schedule({})
  assert.equal(frames, 0, 'a held swipe does not schedule control measurements')
  scrollMiniPlayerDragStyle.value = null
  schedule({})
  scrollMiniPlayerDragStyle.value = {}
  queued()
  assert.equal(layouts, 0, 'a new swipe cancels work queued before it began')
  scrollMiniPlayerDragStyle.value = null
  schedule({})
  queued()
  assert.equal(layouts, 1, 'settled inline controls can be measured again')
})
