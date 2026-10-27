import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { updateSponsorBlockSeekBarState } from '../../src/renderer/helpers/player/sponsorBlockSeekBar.js'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/player-components/SeekPreviewBar.js', import.meta.url), 'utf8')

function fixture() {
  let factory
  class SeekBar {
    constructor(parent, controls) {
      this.video = controls.video
      this.controls = controls
      this.player = {}
      this.eventManager = { listen: (_, type, listener) => controls.listeners.set(type, listener) }
      const properties = new Map()
      this.container = {
        classList: { toggle() {}, remove() {} },
        style: { background: '', setProperty: (name, value) => properties.set(name, value), getPropertyValue: name => properties.get(name) },
        querySelector: () => controls.timePreview,
      }
      this.bar = {
        min: '0', max: '30', events: [],
        getBoundingClientRect: () => ({ left: 100, width: 312 }),
        dispatchEvent(event) { this.events.push(event) },
      }
      this.setValue(this.video.currentTime)
      this.update()
    }
    get value() { return this.getValue() }
    getValue() { return Number(this.bar.value) }
    setValue(time) { this.bar.value = time }
    update() {
      this.paintedTime = this.value
      this.container.style.background = `linear-gradient(to right, red 0%, red 0%, red ${this.value / 30 * 100}%, white ${this.value / 30 * 100}%, white 90%, black 90%)`
    }
    onChangeStart() {}
    onChange() {}
    onChangeEnd() {}
  }
  class SeekFilmstrip {
    constructor() {
      this.time = null
      this.hint = {}
    }
    show(time) {
      this.time = time
      return Promise.resolve()
    }
    hide() { this.time = null }
  }
  vm.runInNewContext(source.replace(/^import .*\n/gm, '').replace('export class', 'class'), {
    updateSponsorBlockSeekBarState,
    SeekFilmstrip,
    i18n: { global: { t: key => key } },
    window: {},
    document: {},
    THUMB_SIZE: 12,
    MouseEvent: class { constructor(type) { this.type = type } },
    shaka: {
      ui: { SeekBar, Controls: { registerSeekBar: value => { factory = value } } },
      util: { FakeEvent: class { constructor(type, init) { Object.assign(this, { type }, init) } } },
    },
  })
  const controls = {
    video: { currentTime: 15, paused: false }, listeners: new Map(), seeking: false, shown: 0, events: [],
    timePreview: { style: { visibility: 'visible' } },
    setSeeking(value) { this.seeking = value }, showUI() { this.shown++; this.seekingWhenShown = this.seeking },
    dispatchEvent(event) { this.events.push(event) },
  }
  const bar = factory.create({}, controls)
  const preview = (time, showPreview = false) => controls.listeners.get('seekpreviewchange')({ time, showPreview })
  const drag = time => {
    bar.setValue(time)
    bar.onChange()
  }
  return { bar, controls, preview, drag }
}

test('ordinary seek bar updates keep following playback', () => {
  const { bar, controls } = fixture()
  assert.equal(bar.value, 15, 'Initial update works before the subclass constructor finishes')
  assert.equal(bar.container.style.getPropertyValue('--sponsorblock-played'), '50')
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
  assert.equal(bar.container.style.getPropertyValue('--sponsorblock-played'), '70')
  assert.equal(controls.seeking, true)
  assert.equal(controls.shown, 1)
  assert.equal(controls.seekingWhenShown, false, 'Shaka keeps paused controls up only while not seeking')
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
    assert.equal(Number(bar.container.style.getPropertyValue('--sponsorblock-played')), 16 / 30 * 100)
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

test('swipe previews show the seek bar time and filmstrip at the thumb', () => {
  const { bar, controls, preview } = fixture()
  preview(20, true)
  assert.equal(bar.filmstrip.time, 20)
  const hover = bar.bar.events.at(-1)
  assert.equal(hover.type, 'mousemove')
  assert.equal(hover.clientX, 100 + 6 + 20.001 / 30 * 300)
  assert.deepEqual({ ...controls.events.at(-1) }, { type: 'seekbarvaluechange', time: 20 })

  preview(20, false)
  assert.equal(bar.filmstrip.time, null, 'Turning off previews hides them during the gesture')
  assert.equal(controls.timePreview.style.visibility, 'hidden')
  assert.equal(bar.value, 20, 'The thumb still follows the gesture')

  controls.timePreview.style.visibility = 'visible'
  preview(21, true)
  preview(null, true)
  assert.equal(bar.filmstrip.time, null)
  assert.equal(controls.timePreview.style.visibility, 'hidden')
})

test('dragging the thumb shows the filmstrip but tapping does not', () => {
  const { bar, controls, drag } = fixture()
  bar.onChangeStart()
  drag(15.1)
  assert.equal(bar.filmstrip.time, null, 'Movement below the drag threshold is still a tap')
  bar.onChangeEnd()
  assert.equal(controls.timePreview.style.visibility, 'visible', 'Shaka hides its own tap preview')

  bar.onChangeStart()
  drag(16)
  assert.equal(bar.filmstrip.time, 16)
  drag(15.2)
  assert.equal(bar.filmstrip.time, 15.2, 'The filmstrip stays until the drag ends')
  bar.onChangeEnd()
  assert.equal(bar.filmstrip.time, null)
  assert.equal(controls.timePreview.style.visibility, 'hidden')

  controls.timePreview.style.visibility = 'visible'
  drag(20)
  assert.equal(bar.filmstrip.time, null, 'Keyboard changes do not show the filmstrip')
})

test('a mouse only shows the filmstrip when dragging the thumb itself', () => {
  const { bar, controls, drag } = fixture()
  const press = clientX => {
    controls.listeners.get('mousedown')({ clientX })
    bar.onChangeStart()
  }
  // The thumb for 15 of 30 seconds is centered at 100 + 6 + 150.
  press(256 + 60)
  drag(20)
  assert.equal(bar.filmstrip.time, null, 'Dragging from elsewhere on the track keeps the single preview')
  bar.onChangeEnd()

  bar.setValue(15)
  press(256 + 5)
  drag(20)
  assert.equal(bar.filmstrip.time, 20)
  bar.onChangeEnd()

  // Touch input has no mouse press and keeps showing the filmstrip.
  bar.setValue(15)
  bar.onChangeStart()
  drag(20)
  assert.equal(bar.filmstrip.time, 20)
})

test('pulling up starts precise seeking from the last dragged time, not a pending strip render', () => {
  const { bar, controls, drag } = fixture()
  // The strip renders asynchronously, here always one move behind.
  let rendering = null
  Object.assign(bar.filmstrip, {
    pixelsPerSecond: 50,
    element: { getBoundingClientRect: () => ({ bottom: 50 }) },
    show(time) {
      this.time = rendering
      rendering = time
      return Promise.resolve()
    },
  })
  const move = (clientX, clientY) => controls.listeners.get('mousemove')({ clientX, clientY })
  bar.onChangeStart()
  move(204, 100)
  drag(10)
  move(304, 100)
  drag(20)
  // Pulling straight up keeps the time even though Shaka maps the pointer again.
  move(304, 0)
  drag(20)
  assert.equal(bar.value, 20)
  // Sideways movement now follows the strip's 50 pixels per second.
  move(354, 0)
  drag(25)
  assert.equal(bar.value, 21)
})
