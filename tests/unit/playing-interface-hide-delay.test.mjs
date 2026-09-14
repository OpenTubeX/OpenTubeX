import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../node_modules/shaka-player/ui/controls.js', import.meta.url), 'utf8')
const bundle = readFileSync(new URL('../../node_modules/shaka-player/dist/shaka-player.ui-es2021.js', import.meta.url), 'utf8')
const template = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.vue', import.meta.url), 'utf8')
const delayExpression = template.match(/:data-playing-interface-hide-delay="([^"]+)"/)[1]

test('custom playback delay is available before resuming in fullscreen or full window', () => {
  for (const [isFullscreen, fullWindowEnabled, expected] of [
    [false, false, null],
    [true, false, 7.5],
    [false, true, 7.5],
    [true, true, 7.5],
  ]) {
    for (const playerPaused of [false, true]) {
      assert.equal(vm.runInNewContext(delayExpression, {
        playerPaused, isFullscreen, fullWindowEnabled, playingInterfaceHideDelay: 7.5,
      }), expected)
    }
  }
})

for (const compiled of [false, true]) {
  test(`${compiled ? 'shipped bundle' : 'Shaka source'} uses the delay for movement, touch, keyboard and seeking`, () => {
    const scheduled = []
    const timer = { stop() {}, tickAfter: seconds => scheduled.push(seconds), Y: seconds => scheduled.push(seconds) }
    const container = { classList: { remove() {} }, dataset: {} }
    let move, seek
    if (compiled) {
      move = vm.runInNewContext(`(${bundle.match(/function oJ\(a,b\)\{[^\n]+/)[0]})`, { uJ() {}, mI() {} })
      seek = vm.runInNewContext(`({${bundle.match(/\$g\(a\)\{[\s\S]*?\}/)[0]}})`)['$g']
    } else {
      move = vm.runInNewContext(`({${source.match(/  onMouseMove_\(event\) \{[\s\S]*?\n  \}/)[0]}})`).onMouseMove_
      seek = vm.runInNewContext(`({${source.match(/  setSeeking\(seeking\) \{[\s\S]*?\n  \}/)[0]}})`).setSeeking
    }
    const controls = {
      videoContainer_: container, controlsContainer_: container,
      mouseStillTimer_: timer, hideSettingsMenusTimer_: timer,
      computeOpacity() {}, isOpaque: () => true,
      m: container, h: container, U: timer, R: timer, Fa: () => true,
    }
    for (const delay of [undefined, '0.5', '3', '7.5', '10']) {
      if (delay === undefined) delete container.dataset.playingInterfaceHideDelay
      else container.dataset.playingInterfaceHideDelay = delay
      for (const type of ['mousemove', 'touchend', 'wheel', 'keyup']) {
        controls.lastTouchEventTime_ = controls.S = null
        if (compiled) move(controls, { type })
        else move.call(controls, { type })
        assert.equal(scheduled.pop(), delay === undefined ? 3 : Number(delay))
      }
      seek.call(controls, true)
      assert.equal(scheduled.length, 0)
      seek.call(controls, false)
      assert.equal(scheduled.pop(), delay === undefined ? 3 : Number(delay))
    }
  })
}
