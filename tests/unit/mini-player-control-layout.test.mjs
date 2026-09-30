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
    USE_OVERFLOW_MENU_WIDTH_THRESHOLD: 634,
    rememberInlinePlayerLayoutHeight() {},
    repairScrollMiniPlaceholderHeight() {},
  })
  for (const [width, expected] of [[633.75, true], [0, true], [634.25, false]]) {
    resized([{ contentBoxSize: [{ inlineSize: width }] }])
    assert.equal(onlyUseOverFlowMenu.value, expected)
  }
})
