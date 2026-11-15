import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const bundle = readFileSync(new URL('../../node_modules/shaka-player/dist/shaka-player.ui-es2021.js', import.meta.url), 'utf8')
test('shipped bundle uses the delay for movement, touch, keyboard and seeking', () => {
  const scheduled = []
  const timer = { stop() {}, tickAfter: seconds => scheduled.push(seconds), aa: seconds => scheduled.push(seconds) }
  const container = { classList: { remove() {} }, dataset: {} }
  const move = vm.runInNewContext(`(${bundle.match(/function CP\(a,b\)\{[\s\S]*?\}(?=function VP\()/)[0]})`, { LP() {}, DP() {} })
  const seek = vm.runInNewContext(`({${bundle.match(/ci\(a\)\{\(this\.ba=\s*a\)[\s\S]*?\}/)[0]}})`).ci
  const controls = {
    videoContainer_: container,
    controlsContainer_: container,
    mouseStillTimer_: timer,
    hideSettingsMenusTimer_: timer,
    computeOpacity() {},
    isOpaque: () => true,
    i: container,
    l: container,
    U: timer,
    W: timer,
    Ha: () => true,
  }
  for (const delay of [undefined, '7.5']) {
    if (delay === undefined) delete container.dataset.playingInterfaceHideDelay
    else container.dataset.playingInterfaceHideDelay = delay
    for (const type of ['mousemove', 'touchend', 'wheel', 'keyup']) {
      controls.lastTouchEventTime_ = controls.V = null
      move(controls, { type })
      assert.equal(scheduled.pop(), delay === undefined ? 3 : Number(delay))
    }
    seek.call(controls, true)
    assert.equal(scheduled.length, 0)
    seek.call(controls, false)
    assert.equal(scheduled.pop(), delay === undefined ? 3 : Number(delay))
  }
})
