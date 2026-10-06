import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const handler = source.match(/ {4}function handleControlsContainerWheel\(event\) \{[\s\S]*?\n {4}\}/)[0]

class ElementStub {
  constructor (className, parent = null) {
    this.classList = { contains: name => className.split(' ').includes(name) }
    this.parent = parent
  }

  closest (selectors) {
    const matches = selectors.split(',').some(selector => this.classList.contains(selector.trim().slice(1)))
    return matches ? this : this.parent?.closest(selectors) ?? null
  }
}

function wheel (target, settings, modifiers = {}) {
  const calls = []
  const state = {
    Element: ElementStub,
    videoPlaybackRateMouseScroll: { value: false },
    videoVolumeMouseScroll: { value: false },
    videoSkipMouseScroll: { value: false },
    ...settings,
    mouseScrollPlaybackRateHandler: () => calls.push('rate'),
    mouseScrollVolumeHandler: () => calls.push('volume'),
    mouseScrollSkipHandler: () => calls.push('seek'),
  }
  const handle = vm.runInNewContext(`(${handler})`, state)
  handle({ target, ...modifiers })
  return calls
}

for (const [setting, action, modifiers] of [
  ['videoSkipMouseScroll', 'seek', {}],
  ['videoPlaybackRateMouseScroll', 'rate', { ctrlKey: true }],
  ['videoPlaybackRateMouseScroll', 'rate', { metaKey: true }],
  ['videoVolumeMouseScroll', 'volume', {}],
]) {
  test(`${action} wheel gestures reach the SVG inside the play button (${Object.keys(modifiers)})`, () => {
    const settings = { [setting]: { value: true } }
    const button = new ElementStub('shaka-play-button')
    assert.deepEqual(wheel(button, settings, modifiers), [action])
    const icon = new ElementStub('shaka-ui-icon', button)
    assert.deepEqual(wheel(icon, settings, modifiers), [action])
    assert.deepEqual(wheel(new ElementStub('', icon), settings, modifiers), [action])
  })
}

test('seek feedback text and SVG paths belong to the video surface', () => {
  const settings = { videoSkipMouseScroll: { value: true } }
  for (const className of ['shaka-rewind-container', 'shaka-fast-forward-container']) {
    const feedback = new ElementStub(className)
    assert.deepEqual(wheel(new ElementStub('', feedback), settings), ['seek'])
    assert.deepEqual(wheel(new ElementStub('', new ElementStub('shaka-ui-icon', feedback)), settings), ['seek'])
  }
})

test('menu buttons, the seek bar, and other toolbar controls keep their wheel events', () => {
  const settings = {
    videoSkipMouseScroll: { value: true },
    videoPlaybackRateMouseScroll: { value: true },
  }
  const controls = new ElementStub('shaka-controls-container')
  for (const className of ['shaka-settings-menu', 'shaka-seek-bar-container', 'shaka-mute-button']) {
    const icon = new ElementStub('shaka-ui-icon', new ElementStub(className, controls))
    assert.deepEqual(wheel(icon, settings), [])
    assert.deepEqual(wheel(icon, settings, { ctrlKey: true }), [])
  }
})
