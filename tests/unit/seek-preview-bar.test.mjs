import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/player-components/SeekPreviewBar.js', import.meta.url), 'utf8')

function fixture() {
  let factory
  class SeekBar {
    constructor(parent, controls) {
      this.video = controls.video
      this.eventManager = { listen: (_, type, listener) => controls.listeners.set(type, listener) }
      this.setValue(this.video.currentTime)
    }
    setValue(time) { this.value = time }
    update() { this.paintedTime = this.value }
  }
  vm.runInNewContext(source.replace(/^import .*\n/, '').replace('export class', 'class'), {
    shaka: { ui: { SeekBar, Controls: { registerSeekBar: value => { factory = value } } } },
  })
  const controls = {
    video: { currentTime: 15, paused: false }, listeners: new Map(), seeking: false, shown: 0,
    setSeeking(value) { this.seeking = value }, showUI() { this.shown++ },
  }
  const bar = factory.create({}, controls)
  const preview = time => controls.listeners.get('seekpreviewchange')({ time })
  return { bar, controls, preview }
}

test('ordinary seek bar updates keep following playback', () => {
  const { bar, controls } = fixture()
  assert.equal(bar.value, 15, 'Initial update works before the subclass constructor finishes')
  controls.video.currentTime = 16
  bar.setValue(16)
  assert.equal(bar.value, 16)
  assert.equal(controls.seeking, false)
  assert.equal(controls.shown, 0)
})

test('preview thumb and played track follow the gesture instead of progress updates', () => {
  const { bar, controls, preview } = fixture()
  preview(21)
  assert.equal(bar.value, 21)
  assert.equal(bar.paintedTime, 21)
  assert.equal(controls.seeking, true)
  assert.equal(controls.shown, 1)
  assert.equal(controls.video.currentTime, 15)
  assert.equal(controls.video.paused, false)
  bar.setValue(15.5)
  bar.update()
  assert.equal(bar.value, 21)
  assert.equal(bar.paintedTime, 21)
  preview(9)
  assert.equal(bar.value, 9)
  assert.equal(bar.paintedTime, 9)
  assert.equal(controls.shown, 1, 'Only beginning a gesture reveals the controls')
})

for (const paused of [false, true]) {
  test(`cancelling restores the current playback position while paused=${paused}`, () => {
    const { bar, controls, preview } = fixture()
    controls.video.paused = paused
    preview(21)
    controls.video.currentTime = 16
    preview(null)
    assert.equal(bar.value, 16)
    assert.equal(bar.paintedTime, 16)
    assert.equal(controls.seeking, false)
    assert.equal(controls.video.paused, paused)
    bar.setValue(16.5)
    assert.equal(bar.value, 16.5)
  })
}

test('releasing a committed seek keeps its new position', () => {
  const { bar, controls, preview } = fixture()
  preview(21)
  controls.video.currentTime = 21
  preview(null)
  assert.equal(bar.value, 21)
  assert.equal(bar.paintedTime, 21)
  assert.equal(controls.seeking, false)
})

test('preview state stays within each player', () => {
  const first = fixture()
  const second = fixture()
  first.preview(21)
  second.bar.setValue(5)
  assert.equal(first.bar.value, 21)
  assert.equal(second.bar.value, 5)
  assert.equal(second.controls.seeking, false)
})
