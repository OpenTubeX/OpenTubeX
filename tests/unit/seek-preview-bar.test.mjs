import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { updateSponsorBlockSeekBarState } from '../../src/renderer/helpers/player/sponsorBlockSeekBar.js'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/player-components/SeekPreviewBar.js', import.meta.url), 'utf8')

function fixture() {
  let factory
  const window = {}
  class SeekBar {
    constructor(parent, controls) {
      this.video = controls.video
      this.controls = controls
      this.player = {}
      // Window listeners share event types with the bar's own, so keep them apart.
      this.eventManager = { listen: (target, type, listener) => controls.listeners.set(target === window ? `window:${type}` : type, listener) }
      const properties = new Map()
      const classes = new Set()
      this.container = {
        classList: {
          toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
          remove: (...names) => names.forEach(name => classes.delete(name)),
          contains: name => classes.has(name),
        },
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
    onChangeStart(fromTouchEvent = false) { this.changeStartedFromTouch = fromTouchEvent }
    onChange() {}
    onChangeEnd() {}
    release() { this.released = true }
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
    window,
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
    config: { showUIAlways: false }, hovered: true, hidden: 0,
    setSeeking(value) { this.seeking = value }, showUI() { this.shown++; this.seekingWhenShown = this.seeking },
    hideUI() { this.hidden++ },
    getConfig() { return this.config },
    getVideoContainer() { return { matches: selector => selector === ':hover' && controls.hovered } },
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

test('touch interactions reach Shaka as touch, so it hides the time preview after a tap', () => {
  const { bar } = fixture()
  bar.onChangeStart(true)
  assert.equal(bar.changeStartedFromTouch, true)
  bar.onChangeStart()
  assert.equal(bar.changeStartedFromTouch, false)
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

test('a mouse drag from anywhere on the track shows the filmstrip and keeps the controls up', () => {
  const { bar, controls, drag } = fixture()
  const press = () => {
    controls.listeners.get('mousedown')()
    bar.onChangeStart()
  }
  // Shaka has already moved the thumb to the pressed spot, so only the drag counts.
  bar.setValue(20)
  press()
  drag(20.1)
  assert.equal(bar.filmstrip.time, null, 'Pressing elsewhere on the track is still a tap')
  drag(22)
  assert.equal(bar.filmstrip.time, 22)
  assert.equal(controls.config.showUIAlways, true, 'Leaving the player or resting must not hide the controls')
  bar.onChangeEnd()
  assert.equal(controls.config.showUIAlways, false)
  assert.deepEqual([controls.shown, controls.hidden], [1, 0], 'Releasing over the player restarts its hide delay')

  controls.hovered = false
  press()
  drag(25)
  bar.onChangeEnd()
  assert.deepEqual([controls.shown, controls.hidden], [1, 1], 'Releasing outside hides them like leaving the player')

  // Shaka rebuilds its controls without ending the drag.
  press()
  drag(28)
  bar.release()
  assert.equal(bar.released, true)
  assert.equal(controls.config.showUIAlways, false, 'The rebuilt controls must not stay forced up')
  assert.deepEqual([controls.shown, controls.hidden], [1, 1])

  // Touch input has no mouse press, and Shaka keeps showing the controls for it.
  bar.setValue(15)
  bar.onChangeStart()
  drag(20)
  assert.equal(bar.filmstrip.time, 20)
  assert.equal(controls.config.showUIAlways, false)
  bar.onChangeEnd()
  assert.deepEqual([controls.shown, controls.hidden], [1, 1])
})

test('pulling up starts precise seeking from the last dragged time, not a pending strip render', () => {
  const { bar, controls, drag } = fixture()
  // The strip renders asynchronously, here always one move behind.
  let rendering = null
  Object.assign(bar.filmstrip, {
    pixelsPerSecond: 50,
    element: { getBoundingClientRect: () => ({ top: 0, height: 50, bottom: 50 }) },
    show(time) {
      this.time = rendering
      rendering = time
      return Promise.resolve()
    },
  })
  const move = (clientX, clientY) => controls.listeners.get('window:mousemove')({ clientX, clientY })
  bar.onChangeStart()
  move(204, 100)
  drag(10)
  move(304, 100)
  drag(20)
  // The lower half of the strip still follows the pointer's spot on the bar.
  move(304, 30)
  drag(20)
  move(314, 30)
  drag(20.5)
  assert.equal(bar.value, 20.5)
  move(304, 30)
  drag(20)
  // Pulling up past its middle keeps the time even though Shaka maps the pointer again.
  move(304, 0)
  drag(20)
  assert.equal(bar.value, 20)
  // Sideways movement now follows the strip's 50 pixels per second.
  move(354, 0)
  drag(25)
  assert.equal(bar.value, 21)
})

test('dragging back below the strip returns to seeking at the bar scale', async () => {
  const { bar, controls, drag } = fixture()
  Object.assign(bar.filmstrip, {
    pixelsPerSecond: 50,
    element: { getBoundingClientRect: () => ({ top: 0, height: 50, bottom: 50 }) },
  })
  const move = (clientX, clientY) => controls.listeners.get('window:mousemove')({ clientX, clientY })
  bar.onChangeStart()
  move(304, 100)
  drag(20)
  move(304, 0)
  drag(20)
  move(354, 0)
  drag(25)
  assert.equal(bar.value, 21)
  // Back in the lower half it stays precise.
  move(354, 40)
  drag(25)
  assert.equal(bar.value, 21)
  // Resizing can leave the strip no finer than the bar; the drag stays precise and says so.
  bar.filmstrip.pixelsPerSecond = 1
  drag(25)
  assert.equal(bar.value, 21)
  await Promise.resolve()
  assert.equal(bar.container.classList.contains('ft-seek-filmstrip-precise'), true)
  assert.equal(bar.filmstrip.hint.textContent, 'Video.Player.Precise seeking, drag down to exit')
  bar.filmstrip.pixelsPerSecond = 50
  // A pending storyboard lookup must not delay the hint when precise seeking ends.
  let finishStoryboardLookup
  bar.filmstrip.show = () => new Promise(resolve => { finishStoryboardLookup = resolve })
  // Below the strip, Shaka's value from the pointer's x applies again.
  move(354, 50)
  drag(25)
  assert.equal(bar.value, 25)
  assert.equal(bar.container.classList.contains('ft-seek-filmstrip-precise'), false)
  assert.equal(bar.filmstrip.hint.textContent, 'Video.Player.Pull up for precise seeking')
  finishStoryboardLookup()
  bar.filmstrip.show = () => Promise.resolve()
  move(364, 50)
  drag(26)
  assert.equal(bar.value, 26)
  // Pulling up again resumes from there.
  move(364, 0)
  drag(26)
  move(314, 0)
  drag(21)
  assert.equal(bar.value, 25)
  bar.onChangeEnd()
  assert.equal(bar.value, 25)
})
