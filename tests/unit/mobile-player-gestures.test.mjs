import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRenderer, nextTick } from 'vue'
import { useMobileFullscreenGestures } from '../../src/renderer/components/ft-shaka-video-player/opentubex/useMobileFullscreenGestures.js'

const playerSource = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')

class ElementStub {
  constructor(selector = '') { this.selector = selector }
  closest(selectors) { return this.selector && selectors.includes(this.selector) ? this : null }
}

function fixture(t, { left = 'brightness', right = 'volume', fullscreenSwipe = true, seekSwipe = () => true, mobile = true, mini = false, dismissible = () => false, reducedMotion = true, shorts = false, height = 200.5, nativeReplay = false, minimize = false, fullscreen = () => false, controls, toggleFullscreen, width = 400, seekState = () => ({ time: 60, start: 0, end: 600 }) } = {}) {
  t.mock.method(globalThis, 'setTimeout', setTimeout)
  const previous = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element, requestAnimationFrame: globalThis.requestAnimationFrame }
  const frames = []
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length }
  globalThis.Element = ElementStub
  globalThis.document = { querySelector: () => ({ classList: { contains: () => mobile } }) }
  globalThis.window = { setTimeout: (...args) => setTimeout(...args), matchMedia: () => ({ matches: reducedMotion }) }
  const surface = new ElementStub()
  const calls = []
  const captures = new Set()
  const container = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 10, width, height }),
    setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id),
  })
  let gestures
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({
    setup() {
      gestures = useMobileFullscreenGestures({
        getContainer: () => container,
        getControls: () => controls ?? ({ getControlsContainer: () => ({ hasAttribute: () => false }), anySettingsMenusAreOpen: () => false, getConfig: () => ({ tapSeekDistance: 0 }), showUI: () => calls.push('show') }),
        getSeekState: seekState,
        seekToTime: time => calls.push(['seek', time]),
        isFullscreenActive: fullscreen,
        isFullscreenMetadataShown: () => false,
        isFullscreenSwipeEnabled: () => fullscreenSwipe,
        isSeekSwipeEnabled: seekSwipe,
        isPlaybackEnded: () => false,
        isPlaybackPaused: () => true,
        isPlayerSurfaceTarget: nativeReplay
          ? vm.runInNewContext(`(${playerSource.match(/function isPlayerSurfaceTarget\(target\) \{[\s\S]*?\n    \}/)[0]})`, {
            Element: ElementStub, video: { value: {} }, container: { value: { hasAttribute: () => true } }
          })
          : target => target === surface,
        isScrollMiniPlayerActive: () => mini,
        isShortsPlayer: () => shorts,
        getSwipeAction: side => side === 'left' ? left : right,
        miniPlayerDrag: {
          canDismiss: dismissible,
          dismiss: () => calls.push('dismiss'),
          begin: () => { if (minimize) calls.push('drag-begin'); return minimize },
          move: (x, y) => calls.push(['drag-move', x, y]),
          finish: commit => calls.push(['drag-finish', commit]),
          cancel() {},
        },
        adjustments: {
          begin: action => calls.push(['begin', action]),
          update: delta => calls.push(['update', delta]),
          finish: () => calls.push('finish'),
          cancel: () => calls.push('cancel'),
        },
        setFullscreenMetadata() {}, setShowUiOnPaused() {}, showOverlayControls() {},
        togglePlayerFullScreen: toggleFullscreen ?? (() => calls.push('fullscreen')),
      })
      return () => null
    },
  })
  app.mount({})
  let mounted = true
  const unmount = () => {
    if (mounted) app.unmount()
    mounted = false
  }
  t.after(() => { unmount(); Object.assign(globalThis, previous) })
  function event(x = 50, y = 150, extra = {}) {
    return { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true, target: surface,
      preventDefault() { this.prevented = true }, stopPropagation() {}, stopImmediatePropagation() {}, ...extra }
  }
  const paint = () => frames.splice(0).forEach(callback => callback())
  return { gestures, calls, event, captures, container, unmount, paint }
}

test('Shorts vertical swipes stay available for feed navigation', t => {
  const { gestures: g, event, calls, captures } = fixture(t, { shorts: true, minimize: true })
  for (const [x, endY] of [[210, 50], [210, 250], [50, 50]]) {
    g.startMobileFullscreenGesture(event(x, 150))
    assert.equal(g.moveMobileFullscreenGesture(event(x, endY)), false)
    g.finishMobileFullscreenGesture(event(x, endY))
  }
  assert.deepEqual(calls, [])
  assert.equal(captures.size, 0)
})

test('Shorts taps still reveal playback controls', t => {
  const { gestures: g, event, calls } = fixture(t, { shorts: true })
  g.startMobileFullscreenGesture(event(210, 150))
  g.finishMobileFullscreenGesture(event(210, 150))
  assert.deepEqual(calls, ['show'])
})

test('left and right vertical swipes use their configured actions with fractional geometry', t => {
  const { gestures: g, event, calls, captures } = fixture(t, { left: 'volume', right: 'brightness', fullscreenSwipe: false })
  for (const [x, action] of [[50, 'volume'], [370, 'brightness']]) {
    calls.length = 0
    g.startMobileFullscreenGesture(event(x))
    assert.equal(g.moveMobileFullscreenGesture(event(x, 49.75)), true)
    g.finishMobileFullscreenGesture(event(x, 49.75))
    assert.deepEqual(calls, [['begin', action], ['update', 0.5], 'finish'])
    assert.equal(captures.size, 0)
    const touchEnd = event()
    g.handleMobilePlayerTouchEnd(touchEnd)
    assert.equal(touchEnd.prevented, true)
    g.handleMobilePlayerSurfaceClick(event(x))
    assert.equal(calls.includes('show'), false)
  }
})

test('a tap still shows controls and does not call native adjustments', t => {
  const { gestures: g, event, calls } = fixture(t)
  g.startMobileFullscreenGesture(event())
  g.moveMobileFullscreenGesture(event(51, 148))
  g.finishMobileFullscreenGesture(event(51, 148))
  assert.deepEqual(calls, ['show'])
})

test('center swipes retain fullscreen and disabled sides allow fullscreen swipes', t => {
  const { gestures: g, event, calls } = fixture(t, { left: 'disabled' })
  for (const x of [50, 210]) {
    g.startMobileFullscreenGesture(event(x))
    assert.equal(g.moveMobileFullscreenGesture(event(x, 50)), true)
    assert.equal(g.mobileFullscreenSwiping.value, true)
    g.cancelMobileFullscreenGesture()
  }
  assert.deepEqual(calls, [])
})

test('committed fullscreen swipe starts after painting without a settle delay', async t => {
  const { gestures: g, event, calls, paint } = fixture(t, { reducedMotion: false })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  g.startMobileFullscreenGesture(event(210, 150))
  g.moveMobileFullscreenGesture(event(210, 50))
  g.finishMobileFullscreenGesture(event(210, 50))
  t.mock.timers.tick(0)
  await nextTick()
  paint()
  paint()
  await Promise.resolve()
  assert.equal(calls.includes('fullscreen'), true, 'A committed swipe must not wait for the 140 ms settle animation')
})

for (const interrupt of ['none', 'new touch', 'cancel', 'unmount', 'fullscreen changed']) {
  test(`fullscreen swipe paints its reset before handoff (${interrupt})`, async t => {
    let fullscreen = false
    const { gestures: g, event, calls, paint, unmount } = fixture(t, {
      fullscreen: () => fullscreen,
    })
    t.mock.timers.enable({ apis: ['setTimeout'] })
    g.startMobileFullscreenGesture(event(210, 150))
    g.moveMobileFullscreenGesture(event(210, 50))
    g.finishMobileFullscreenGesture(event(210, 50))
    t.mock.timers.tick(0)
    await nextTick()
    assert.equal(g.mobileFullscreenSwipeStyle.value, undefined)
    assert.equal(calls.includes('fullscreen'), false)
    paint()
    assert.equal(calls.includes('fullscreen'), false, 'One animation callback does not guarantee a painted frame')
    if (interrupt === 'new touch') g.startMobileFullscreenGesture(event(210, 150))
    if (interrupt === 'cancel') g.cancelMobileFullscreenGesture()
    if (interrupt === 'unmount') unmount()
    if (interrupt === 'fullscreen changed') fullscreen = true
    paint()
    await Promise.resolve()
    assert.equal(calls.includes('fullscreen'), interrupt === 'none')
    await Promise.resolve()
  })
}

test('rejected fullscreen entry is handled', async t => {
  t.mock.method(console, 'warn', () => {})
  const { gestures: g, event, paint } = fixture(t, {
    toggleFullscreen: () => Promise.reject(new Error('Fullscreen rejected')),
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  g.startMobileFullscreenGesture(event(210, 150))
  g.moveMobileFullscreenGesture(event(210, 50))
  g.finishMobileFullscreenGesture(event(210, 50))
  t.mock.timers.tick(0)
  await nextTick()
  paint()
  paint()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(console.warn.mock.callCount(), 1)
})

test('fullscreen swipe controls auto-hide after the configured delay despite suppressed touchend', async t => {
  // Exercise Shaka's real touch/mouse and opacity methods. touchmove stops its
  // idle timer, while the app consumes touchend to prevent a second surface tap.
  const source = readFileSync(new URL('../../node_modules/shaka-player/ui/controls.js', import.meta.url), 'utf8')
  const shaka = { ui: {}, util: { FakeEventTarget: class {} } }
  vm.runInNewContext(source.slice(source.indexOf('shaka.ui.Controls = class'), source.indexOf('\n};') + 3), {
    shaka, Event, Date, goog: { asserts: { assert } },
  })
  const controls = Object.create(shaka.ui.Controls.prototype)
  const attributes = new Map()
  const classList = { add() {}, remove() {}, contains: () => false }
  const timer = callback => {
    let id
    return {
      stop() { clearTimeout(id) },
      tickAfter(seconds) { this.stop(); id = setTimeout(callback, seconds * 1000) },
    }
  }
  Object.assign(controls, {
    enabled_: true,
    controlsContainer_: {
      classList,
      getAttribute: name => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, value),
      hasAttribute: name => attributes.has(name),
    },
    videoContainer_: { classList, dataset: {} },
    video_: { paused: false },
    config_: { showUIOnPaused: true, fadeDelay: 0.5 },
    isHovered_: () => false,
    shouldShowUIAlways_: () => false,
    anySettingsMenusAreOpen: () => false,
    updateTimeAndSeekRange_() {},
    dispatchVisibilityEvent_() {},
    computeShakaTextContainerSize_() {},
    hideSettingsMenusTimer_: timer(() => {}),
    fadeControlsTimer_: timer(() => attributes.delete('shown')),
    mouseStillTimer_: timer(() => controls.onMouseStill_()),
  })
  let fullscreen = false
  const { gestures: g, event, container, paint } = fixture(t, {
    controls,
    fullscreen: () => fullscreen,
    toggleFullscreen: () => {
      fullscreen = true
      // The presentation change can cancel the old pointer gesture while the
      // accepted fullscreen promise is still completing.
      g.cancelMobileFullscreenGesture()
      controls.videoContainer_.dataset.playingInterfaceHideDelay = '2'
      controls.showUI()
    },
  })
  for (const type of ['touchmove', 'touchend']) {
    container.addEventListener(type, event => controls.onMouseMove_(event))
  }
  t.mock.timers.enable({ apis: ['setTimeout'] })
  g.startMobileFullscreenGesture(event(210, 150))
  g.moveMobileFullscreenGesture(event(210, 50))
  container.dispatchEvent(new Event('touchmove'))
  g.finishMobileFullscreenGesture(event(210, 50))
  const touchEnd = event()
  g.handleMobilePlayerTouchEnd(touchEnd)
  assert.equal(touchEnd.prevented, true)
  t.mock.timers.tick(0)
  await nextTick()
  paint()
  paint()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(fullscreen, true)
  assert.equal(attributes.has('shown'), true)
  t.mock.timers.tick(1999)
  assert.equal(attributes.has('shown'), true, 'Controls respect the configured idle delay')
  t.mock.timers.tick(1)
  t.mock.timers.tick(500)
  assert.equal(attributes.has('shown'), false, 'Controls must hide without another tap')
})

test('horizontal movement never becomes an adjustment later in the same gesture', t => {
  const { gestures: g, event, calls } = fixture(t)
  g.startMobileFullscreenGesture(event())
  g.moveMobileFullscreenGesture(event(100, 149))
  g.moveMobileFullscreenGesture(event(100, 50))
  g.finishMobileFullscreenGesture(event(100, 50))
  assert.deepEqual(calls, [])
})

test('a second finger cancels adjustments for pinch zoom, even when zoom is disabled', t => {
  const { gestures: g, event, calls, captures } = fixture(t)
  g.startMobileFullscreenGesture(event())
  g.moveMobileFullscreenGesture(event(50, 100))
  g.startMobileFullscreenGesture(event(100, 100, { pointerId: 2, isPrimary: false }))
  assert.equal(calls.at(-1), 'cancel')
  assert.equal(captures.size, 0)
  const count = calls.length
  g.moveMobileFullscreenGesture(event(50, 50))
  g.finishMobileFullscreenGesture(event(50, 50))
  assert.equal(calls.length, count)
})

for (const [name, options, extra] of [
  ['desktop', { mobile: false }, {}],
  ['mini player', { mini: true }, {}],
  ['mouse', {}, { pointerType: 'mouse' }],
  ['menu control', {}, { target: new ElementStub() }],
  ['disabled sides', { left: 'disabled', fullscreenSwipe: false }, {}],
]) {
  test(`does not adjust from ${name}`, t => {
    const { gestures: g, event, calls } = fixture(t, options)
    g.startMobileFullscreenGesture(event(50, 150, extra))
    g.moveMobileFullscreenGesture(event(50, 50, extra))
    g.finishMobileFullscreenGesture(event(50, 50, extra))
    assert.deepEqual(calls, [])
  })
}

test('a slightly diagonal start can settle into a vertical side swipe', t => {
  const { gestures: g, event, calls } = fixture(t)
  g.startMobileFullscreenGesture(event(50, 150))
  g.moveMobileFullscreenGesture(event(63, 138))
  g.moveMobileFullscreenGesture(event(64, 100))
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'begin'), true)
})

test('a side swipe that starts on a toolbar button does not click the button on release', t => {
  const { gestures: g, event } = fixture(t)
  const target = new ElementStub('.shaka-controls-button-panel')
  g.startMobileFullscreenGesture(event(370, 150, { target }))
  g.moveMobileFullscreenGesture(event(370, 100, { target }))
  g.finishMobileFullscreenGesture(event(370, 100, { target }))
  const click = event(370, 100, { target })
  assert.equal(g.handleMobilePlayerSurfaceClick(click), true)
  assert.equal(click.prevented, true)
})

for (const [side, x] of [['left', 50], ['right', 370]]) {
  test(`playback speed works on the ${side} with fullscreen swiping disabled`, t => {
    const { gestures: g, event, calls } = fixture(t, { left: 'disabled', right: 'disabled', [side]: 'speed', fullscreenSwipe: false })
    g.startMobileFullscreenGesture(event(x))
    assert.equal(g.moveMobileFullscreenGesture(event(x, 49.75)), true)
    g.finishMobileFullscreenGesture(event(x, 49.75))
    assert.deepEqual(calls, [['begin', 'speed'], ['update', 0.5], 'finish'])
    assert.equal(calls.includes('fullscreen'), false)
  })
}

for (const [placement, x] of [['toolbar', 50], ['center', 210]]) {
  test(`native ${placement} replay taps reach the button without gesture suppression`, t => {
    const { gestures: g, event, calls } = fixture(t, { nativeReplay: true })
    const target = new ElementStub('.shaka-play-button')
    target.classList = { contains: () => false }
    target.closest = selectors => selectors.includes('.shaka-play-button') ||
      (placement === 'toolbar' && selectors.includes('.shaka-controls-button-panel')) ? target : null
    g.startMobileFullscreenGesture(event(x, 150, { target }))
    g.finishMobileFullscreenGesture(event(x, 150, { target }))
    const touchEnd = event(x, 150, { target })
    g.handleMobilePlayerTouchEnd(touchEnd)
    assert.notEqual(touchEnd.prevented, true, 'Touch end must allow the replay click')
    const click = event(x, 150, { target })
    assert.equal(g.handleMobilePlayerSurfaceClick(click), false, 'Click capture must allow Shaka to receive replay')
    assert.notEqual(click.prevented, true)
    assert.deepEqual(calls, [])
  })
}

for (const fullscreenSwipe of [true, false]) {
  test(`center drag minimizes independently of fullscreen swipe setting (${fullscreenSwipe})`, t => {
    const { gestures: g, event, calls, captures } = fixture(t, { minimize: true, fullscreenSwipe })
    g.startMobileFullscreenGesture(event(210, 150))
    assert.equal(g.moveMobileFullscreenGesture(event(212, 190)), true)
    assert.equal(g.moveMobileFullscreenGesture(event(214, 260)), true)
    assert.equal(g.finishMobileFullscreenGesture(event(214, 260)), true)
    assert.deepEqual(calls, ['drag-begin', ['drag-move', 2, 40], ['drag-move', 4, 110], ['drag-finish', true]])
    assert.equal(captures.size, 0)
    const click = event(214, 260)
    g.handleMobilePlayerSurfaceClick(click)
    assert.equal(calls.includes('show'), false)
    assert.equal(calls.includes('fullscreen'), false)
  })
}

test('short or reversed center drag returns to the inline player', t => {
  const { gestures: g, event, calls } = fixture(t, { minimize: true })
  g.startMobileFullscreenGesture(event(210, 150))
  g.moveMobileFullscreenGesture(event(210, 250))
  g.moveMobileFullscreenGesture(event(210, 170))
  g.finishMobileFullscreenGesture(event(210, 170))
  assert.deepEqual(calls.at(-1), ['drag-finish', false])
})

for (const secondFinger of [false, true]) {
  test(`canceling minimization restores the inline player (${secondFinger ? 'second finger' : 'pointer cancel'})`, t => {
    const { gestures: g, event, calls, captures } = fixture(t, { minimize: true })
    g.startMobileFullscreenGesture(event(210, 150))
    g.moveMobileFullscreenGesture(event(210, 250))
    if (secondFinger) g.startMobileFullscreenGesture(event(220, 200, { pointerId: 2, isPrimary: false }))
    else g.cancelMobileFullscreenGesture(event())
    assert.deepEqual(calls.at(-1), ['drag-finish', false])
    assert.equal(captures.size, 0)
    g.finishMobileFullscreenGesture(event(210, 250))
    assert.equal(calls.filter(call => Array.isArray(call) && call[0] === 'drag-finish').length, 1)
  })
}

test('side adjustments retain priority over minimization', t => {
  const { gestures: g, event, calls } = fixture(t, { minimize: true })
  g.startMobileFullscreenGesture(event(50, 150))
  g.moveMobileFullscreenGesture(event(50, 250))
  g.finishMobileFullscreenGesture(event(50, 250))
  assert.equal(calls.includes('drag-begin'), false)
  assert.deepEqual(calls[0], ['begin', 'brightness'])
})


for (const distance of [24, 120]) {
  test(`upward mini-player swipe ${distance}px restores or cancels`, t => {
    const { gestures: g, event, calls } = fixture(t, { mini: true, minimize: true })
    g.startMobileFullscreenGesture(event(210, 400))
    assert.equal(g.moveMobileFullscreenGesture(event(210, 400 - distance)), true)
    assert.equal(g.finishMobileFullscreenGesture(event(210, 400 - distance)), true)
    assert.deepEqual(calls, ['drag-begin', ['drag-move', 0, -distance], ['drag-finish', distance >= 64]])
  })
}

test('a teleported player receives release outside its DOM and removes window listeners', () => {
  const start = playerSource.indexOf('    const playerPointerIds =')
  const end = playerSource.indexOf('    onBeforeUnmount(clearPlayerPointers)', start)
  const handlers = new Map()
  const calls = []
  const track = vm.runInNewContext(`${playerSource.slice(start, end)}; trackPlayerPointer`, {
    window: {
      addEventListener: (type, handler) => handlers.set(type, handler),
      removeEventListener: type => handlers.delete(type),
    },
    handleVideoZoomPointerMove: e => calls.push(['move', e.pointerId]),
    handleVideoZoomPointerUp: e => calls.push(['up', e.pointerId]),
    handleVideoZoomPointerCancel: e => calls.push(['cancel', e.pointerId]),
  })
  track({ pointerId: 7 })
  handlers.get('pointermove')({ pointerId: 8 })
  handlers.get('pointermove')({ pointerId: 7, target: {} })
  handlers.get('pointerup')({ pointerId: 7, target: {}, type: 'pointerup' })
  assert.deepEqual(calls, [['move', 7], ['up', 7]])
  assert.equal(handlers.size, 0)
  track({ pointerId: 9 })
  handlers.get('pointercancel')({ pointerId: 9, type: 'pointercancel' })
  assert.deepEqual(calls.at(-1), ['cancel', 9])
  assert.equal(handlers.size, 0)
})

test('revealing Watch preserves a drag and completed dismissal survives visibility changes, but changing video cancels', () => {
  const start = playerSource.indexOf('    watch([isActiveTab, scrollMiniPlayerActive, mobileAdjustmentsVisible, () => props.videoId]')
  const end = playerSource.indexOf('\n    watch(', start + 10)
  let changed
  const resets = []
  const dragging = { value: {} }
  const dismissing = { value: false }
  vm.runInNewContext(playerSource.slice(start, end), {
    watch: (_sources, callback) => { changed = callback },
    isActiveTab: {}, scrollMiniPlayerActive: {}, mobileAdjustmentsVisible: {}, props: { videoId: 'video' },
    scrollMiniPlayerDragStyle: dragging,
    mobileMiniPlayerDismissSettling: dismissing,
    mobileFullscreenBrightnessActive: { value: false },
    resetMobileAdjustments: preserve => resets.push(preserve),
  })
  changed([true, true, true, 'video'], [false, true, true, 'video'])
  changed([false, true, true, 'video'], [true, true, true, 'video'])
  changed([true, true, false, 'video'], [true, true, true, 'video'])
  changed([true, true, true, 'other'], [true, true, true, 'video'])
  assert.deepEqual(resets, [true, false, false, false])
  resets.length = 0
  dragging.value = null
  dismissing.value = true
  changed([false, true, false, 'video'], [false, true, true, 'video'])
  changed([false, true, true, 'video'], [false, true, false, 'video'])
  changed([false, true, false, 'other'], [false, true, true, 'video'])
  changed([false, true, true, 'other'], [false, true, false, 'video'])
  assert.deepEqual(resets, [true, true, false, false])
})


test('upward swipe also starts on the mini-player transparent touch layer', t => {
  const { gestures: g, event, calls } = fixture(t, { mini: true, minimize: true })
  const target = new ElementStub('.scrollMiniPointerLayer')
  g.startMobileFullscreenGesture(event(210, 400, { target }))
  assert.equal(g.moveMobileFullscreenGesture(event(210, 300, { target })), true)
  g.finishMobileFullscreenGesture(event(210, 300, { target }))
  assert.deepEqual(calls.at(-1), ['drag-finish', true])
})

test('tapping the full-bar return button leaves restoration to its native click', t => {
  const { gestures: g, event, calls } = fixture(t, { mini: true, minimize: true })
  const target = new ElementStub('.mobileMiniBarReturn')
  g.startMobileFullscreenGesture(event(210, 400, { target }))
  const release = event(210, 400, { target })
  assert.equal(g.finishMobileFullscreenGesture(release), false)
  assert.notEqual(release.prevented, true)
  assert.equal(g.handleMobilePlayerSurfaceClick(event(210, 400, { target })), false)
  assert.deepEqual(calls, [])
})

test('upward swipes on the full-bar return button restore the video', t => {
  const { gestures: g, event, calls, captures } = fixture(t, { mini: true, minimize: true })
  const target = new ElementStub('.mobileMiniBarReturn')
  g.startMobileFullscreenGesture(event(210, 400, { target }))
  assert.equal(g.moveMobileFullscreenGesture(event(210, 300, { target })), true)
  assert.equal(g.finishMobileFullscreenGesture(event(210, 300, { target })), true)
  assert.deepEqual(calls.at(-1), ['drag-finish', true])
  assert.equal(captures.size, 0)
  assert.equal(calls.includes('return-to-video'), false)
})

test('the mini-player close button does not start tap or swipe restoration', t => {
  const { gestures: g, event, calls } = fixture(t, { mini: true, minimize: true })
  const target = new ElementStub('.mobileMiniBarDismiss')
  for (const distance of [0, 100]) {
    g.startMobileFullscreenGesture(event(210, 400, { target }))
    assert.equal(g.moveMobileFullscreenGesture(event(210, 400 - distance, { target })), false)
    assert.equal(g.finishMobileFullscreenGesture(event(210, 400 - distance, { target })), false)
    assert.equal(g.handleMobilePlayerSurfaceClick(event(210, 400 - distance, { target })), false)
  }
  assert.deepEqual(calls, [])
})

test('a rejected scroll-mini-player restore never enters fullscreen or retains capture', t => {
  const { gestures: g, event, calls, captures } = fixture(t, { mini: true, minimize: false })
  g.startMobileFullscreenGesture(event(210, 300))
  for (const y of [288, 260, 180]) {
    assert.equal(g.moveMobileFullscreenGesture(event(210, y)), false)
    assert.equal(g.mobileFullscreenSwiping.value, false)
  }
  assert.equal(g.finishMobileFullscreenGesture(event(210, 180)), false)
  assert.equal(calls.includes('fullscreen'), false)
  assert.equal(captures.size, 0)
})

for (const distance of [24, 64, 100]) {
  test(`downward mini-player swipe ${distance}px closes only after the threshold`, async t => {
    const { gestures: g, event, calls, captures } = fixture(t, { mini: true, dismissible: () => true, fullscreenSwipe: false })
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const target = new ElementStub('.mobileMiniBarReturn')
    g.startMobileFullscreenGesture(event(210, 400, { target }))
    assert.equal(g.moveMobileFullscreenGesture(event(212, 400 + distance, { target })), true)
    assert.equal(g.mobileFullscreenSwipeStyle.value['--mobile-mini-dismiss-offset'], `${distance}px`)
    assert.equal(g.finishMobileFullscreenGesture(event(212, 400 + distance, { target })), true)
    assert.equal(captures.size, 0)
    assert.equal(g.handleMobilePlayerSurfaceClick(event(212, 400 + distance, { target })), true)
    await nextTick()
    t.mock.timers.tick(0)
    assert.deepEqual(calls, distance >= 64 ? ['dismiss'] : [])
    assert.equal(g.mobileFullscreenSwipeStyle.value, undefined)
  })
}

test('downward swipe leaves a same-page scroll mini-player open', t => {
  const { gestures: g, event, calls } = fixture(t, { mini: true, minimize: true })
  g.startMobileFullscreenGesture(event(210, 400))
  assert.equal(g.moveMobileFullscreenGesture(event(210, 500)), false)
  g.finishMobileFullscreenGesture(event(210, 500))
  assert.deepEqual(calls, [])
})

for (const reason of ['reversed', 'pointer cancel', 'second finger', 'unavailable']) {
  test(`dismissal cancels when ${reason}`, async t => {
    let available = true
    const { gestures: g, event, calls, captures } = fixture(t, { mini: true, dismissible: () => available })
    t.mock.timers.enable({ apis: ['setTimeout'] })
    g.startMobileFullscreenGesture(event(210, 400))
    g.moveMobileFullscreenGesture(event(210, 500))
    if (reason === 'reversed') {
      g.moveMobileFullscreenGesture(event(210, 390))
      g.finishMobileFullscreenGesture(event(210, 390))
    } else if (reason === 'pointer cancel') g.cancelMobileFullscreenGesture(event())
    else if (reason === 'second finger') g.startMobileFullscreenGesture(event(220, 480, { pointerId: 2, isPrimary: false }))
    else {
      g.finishMobileFullscreenGesture(event(210, 500))
      available = false
    }
    await nextTick()
    t.mock.timers.tick(0)
    assert.deepEqual(calls, [])
    assert.equal(captures.size, 0)
    assert.equal(g.mobileFullscreenSwipeStyle.value, undefined)
  })
}

for (const unmounted of [false, true]) {
  test(`dismissal waits for its release animation${unmounted ? ' and is canceled on unmount' : ''}`, async t => {
    const { gestures: g, event, calls, unmount } = fixture(t, { mini: true, dismissible: () => true, reducedMotion: false })
    t.mock.timers.enable({ apis: ['setTimeout'] })
    g.startMobileFullscreenGesture(event(210, 400))
    g.moveMobileFullscreenGesture(event(210, 500))
    g.finishMobileFullscreenGesture(event(210, 500))
    assert.equal(g.mobileFullscreenSwipeStyle.value['--mobile-mini-dismiss-duration'], '140ms')
    await nextTick()
    t.mock.timers.tick(139)
    assert.deepEqual(calls, [])
    if (unmounted) unmount()
    t.mock.timers.tick(1)
    assert.deepEqual(calls, unmounted ? ['cancel'] : ['dismiss'])
    assert.equal(g.mobileFullscreenSwipeStyle.value, undefined)
  })
}

for (const primary of [false, true]) {
  test(`committed dismissal ignores a new ${primary ? 'primary' : 'secondary'} touch during settling`, async t => {
    const { gestures: g, event, calls } = fixture(t, { mini: true, dismissible: () => true, reducedMotion: false })
    t.mock.timers.enable({ apis: ['setTimeout'] })
    g.startMobileFullscreenGesture(event(210, 400))
    g.moveMobileFullscreenGesture(event(210, 500))
    g.finishMobileFullscreenGesture(event(210, 500))
    await nextTick()
    t.mock.timers.tick(70)
    g.startMobileFullscreenGesture(event(220, 480, { pointerId: 2, isPrimary: primary }))
    assert.equal(g.mobileFullscreenSwipeStyle.value?.['--mobile-mini-dismiss-offset'], '296.5px')
    t.mock.timers.tick(70)
    assert.deepEqual(calls, ['dismiss'])
    assert.equal(g.mobileFullscreenSwipeStyle.value, undefined)
  })
}

test('a video-change cancellation stops a committed dismissal before replacement playback', async t => {
  const { gestures: g, event, calls } = fixture(t, { mini: true, dismissible: () => true, reducedMotion: false })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  g.startMobileFullscreenGesture(event(210, 400))
  g.moveMobileFullscreenGesture(event(210, 500))
  g.finishMobileFullscreenGesture(event(210, 500))
  await nextTick()
  t.mock.timers.tick(70)
  g.cancelMobileFullscreenGesture()
  t.mock.timers.tick(70)
  assert.deepEqual(calls, [])
  assert.equal(g.mobileFullscreenSwipeStyle.value, undefined)
})

for (const selector of ['.mobileMiniBarDismiss', '.mobileMiniBarPlayPause', '.mobileMiniBarPlayback']) {
  test(`downward swipes on ${selector} keep its control action separate`, t => {
    const { gestures: g, event, calls } = fixture(t, { mini: true, dismissible: () => true })
    const target = new ElementStub(selector)
    g.startMobileFullscreenGesture(event(210, 400, { target }))
    assert.equal(g.moveMobileFullscreenGesture(event(210, 500, { target })), false)
    g.finishMobileFullscreenGesture(event(210, 500, { target }))
    assert.deepEqual(calls, [])
  })
}


test('does not reenter fullscreen when iPadOS already exited during a downward swipe', async t => {
  let fullscreen = true
  const { gestures: g, event, calls } = fixture(t, { fullscreen: () => fullscreen })
  g.startMobileFullscreenGesture(event(210, 50))
  g.moveMobileFullscreenGesture(event(210, 150))
  fullscreen = false
  g.finishMobileFullscreenGesture(event(210, 150))
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(calls, [])
})

for (const [direction, x, endX, time] of [[1, 50, 150, 90], [-1, 370, 270, 30]]) {
  test(`fullscreen horizontal swipe previews and commits ${direction > 0 ? 'forward' : 'backward'} seeking`, t => {
    const { gestures: g, event, calls, captures } = fixture(t, { fullscreen: () => true, fullscreenSwipe: false })
    g.startMobileFullscreenGesture(event(x, 150))
    assert.equal(g.moveMobileFullscreenGesture(event(x + direction * 5, 151)), false)
    assert.equal(g.mobileSeekPreview.value, null, 'Small movements remain taps')
    assert.equal(g.moveMobileFullscreenGesture(event(endX, 152)), true)
    assert.deepEqual(g.mobileSeekPreview.value, { time, seconds: time - 60 })
    assert.deepEqual(calls, [], 'Preview must not seek or adjust volume/brightness')
    assert.equal(captures.size, 1)
    assert.equal(g.moveMobileFullscreenGesture(event(endX, 250)), true, 'Seeking stays locked despite vertical drift')
    assert.equal(g.mobileFullscreenSwiping.value, false)
    assert.equal(g.finishMobileFullscreenGesture(event(endX, 250)), true)
    assert.deepEqual(calls, [['seek', time]])
    assert.equal(g.mobileSeekPreview.value, null)
    assert.equal(captures.size, 0)
    const touchEnd = event(endX, 250)
    g.handleMobilePlayerTouchEnd(touchEnd)
    assert.equal(touchEnd.prevented, true)
    g.handleMobilePlayerSurfaceClick(event(endX, 250))
    assert.deepEqual(calls, [['seek', time]], 'Release must not toggle controls or seek again')
  })
}

test('horizontal seek can reverse and return to its starting time', t => {
  const { gestures: g, event, calls } = fixture(t, { fullscreen: () => true })
  g.startMobileFullscreenGesture(event(210, 150))
  g.moveMobileFullscreenGesture(event(310, 150))
  g.moveMobileFullscreenGesture(event(110, 150))
  assert.deepEqual(g.mobileSeekPreview.value, { time: 30, seconds: -30 })
  g.moveMobileFullscreenGesture(event(210, 150))
  assert.deepEqual(g.mobileSeekPreview.value, { time: 60, seconds: 0 })
  g.finishMobileFullscreenGesture(event(210, 150))
  assert.deepEqual(calls, [['seek', 60]])
})

for (const [name, range, deltaX, expected] of [
  ['start', { time: 25, start: 20, end: 620 }, -100, 20],
  ['end', { time: 615, start: 20, end: 620 }, 100, 620],
  ['short video', { time: 10, start: 0, end: 40 }, 100, 20],
]) {
  test(`horizontal seek respects the ${name} with fractional player geometry`, t => {
    const { gestures: g, event, calls } = fixture(t, { fullscreen: () => true, width: 400.5, seekState: () => range })
    g.startMobileFullscreenGesture(event(210, 150))
    g.moveMobileFullscreenGesture(event(210 + deltaX, 150))
    assert.deepEqual(g.mobileSeekPreview.value, { time: expected, seconds: expected - range.time })
    g.finishMobileFullscreenGesture(event(210 + deltaX, 150))
    assert.deepEqual(calls, [['seek', expected]])
  })
}

for (const cancellation of ['pointercancel', 'pinch', 'video change', 'unmount', 'fullscreen exit']) {
  test(`${cancellation} discards horizontal seek preview`, t => {
    let fullscreen = true
    const { gestures: g, event, calls, captures, unmount } = fixture(t, { fullscreen: () => fullscreen })
    g.startMobileFullscreenGesture(event(210, 150))
    g.moveMobileFullscreenGesture(event(310, 150))
    if (cancellation === 'pointercancel') g.cancelMobileFullscreenGesture(event(310, 150))
    else if (cancellation === 'pinch') g.startMobileFullscreenGesture(event(320, 150, { pointerId: 2, isPrimary: false }))
    else if (cancellation === 'video change') g.cancelMobileFullscreenGesture()
    else if (cancellation === 'unmount') unmount()
    else fullscreen = false
    g.finishMobileFullscreenGesture(event(310, 150))
    assert.equal(g.mobileSeekPreview.value, null)
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'seek'), false)
    if (cancellation !== 'unmount') assert.equal(captures.size, 0)
  })
}

for (const [name, options, extra] of [
  ['inline player', {}, {}],
  ['desktop', { mobile: false }, {}],
  ['mini player', { mini: true }, {}],
  ['Shorts', { shorts: true }, {}],
  ['unseekable media', { seekState: () => null }, {}],
  ['mouse', {}, { pointerType: 'mouse' }],
  ['play button', {}, { target: new ElementStub('.shaka-play-button') }],
  ['toolbar', {}, { target: new ElementStub('.shaka-controls-button-panel') }],
  ['seek bar', {}, { target: new ElementStub('.shaka-seek-bar-container') }],
]) {
  test(`horizontal seeking excludes ${name}`, t => {
    const { gestures: g, event, calls } = fixture(t, { fullscreen: () => name !== 'inline player', ...options })
    g.startMobileFullscreenGesture(event(210, 150, extra))
    assert.equal(g.moveMobileFullscreenGesture(event(310, 150, extra)), false)
    g.finishMobileFullscreenGesture(event(310, 150, extra))
    assert.equal(g.mobileSeekPreview.value, null)
    assert.deepEqual(calls, [])
  })
}

test('an active vertical side swipe cannot become a horizontal seek', t => {
  const { gestures: g, event, calls } = fixture(t, { fullscreen: () => true })
  g.startMobileFullscreenGesture(event(50, 150))
  g.moveMobileFullscreenGesture(event(50, 100))
  g.moveMobileFullscreenGesture(event(200, 100))
  g.finishMobileFullscreenGesture(event(200, 100))
  assert.equal(g.mobileSeekPreview.value, null)
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'seek'), false)
  assert.deepEqual(calls.at(-1), 'finish')
})

test('an open settings menu leaves horizontal swipes to the menu', t => {
  const controls = {
    getControlsContainer: () => ({ hasAttribute: () => true }),
    anySettingsMenusAreOpen: () => true,
  }
  const { gestures: g, event, calls } = fixture(t, { fullscreen: () => true, controls })
  g.startMobileFullscreenGesture(event(210, 150))
  assert.equal(g.moveMobileFullscreenGesture(event(310, 150)), false)
  g.finishMobileFullscreenGesture(event(310, 150))
  assert.equal(g.mobileSeekPreview.value, null)
  assert.deepEqual(calls, [])
})

test('a center vertical fullscreen exit cannot become a horizontal seek', t => {
  const { gestures: g, event, calls } = fixture(t, { fullscreen: () => true })
  g.startMobileFullscreenGesture(event(210, 150))
  assert.equal(g.moveMobileFullscreenGesture(event(210, 190)), true)
  g.moveMobileFullscreenGesture(event(350, 190))
  assert.equal(g.mobileSeekPreview.value, null)
  assert.equal(g.mobileFullscreenSwiping.value, true)
  g.cancelMobileFullscreenGesture()
  assert.deepEqual(calls, [])
})


test('disabled horizontal seek leaves fullscreen swipes without seeking', t => {
  const { gestures: g, event, calls } = fixture(t, { fullscreen: () => true, seekSwipe: () => false })
  g.startMobileFullscreenGesture(event(150, 150))
  g.moveMobileFullscreenGesture(event(250, 150))
  assert.equal(g.mobileSeekPreview.value, null)
  g.finishMobileFullscreenGesture(event(250, 150))
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'seek'), false)
})

test('disabling horizontal seek during a gesture prevents the commit', t => {
  let enabled = true
  const { gestures: g, event, calls } = fixture(t, { fullscreen: () => true, seekSwipe: () => enabled })
  g.startMobileFullscreenGesture(event(150, 150))
  g.moveMobileFullscreenGesture(event(250, 150))
  assert.ok(g.mobileSeekPreview.value)
  enabled = false
  g.finishMobileFullscreenGesture(event(250, 150))
  assert.equal(g.mobileSeekPreview.value, null)
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'seek'), false)
})

test('cancelled seeking suppresses late touch releases until both fingers are lifted', t => {
  let now = 1000
  t.mock.method(performance, 'now', () => now)
  const { gestures: g, event, calls } = fixture(t, { fullscreen: () => true })
  g.startMobileFullscreenGesture(event(150, 150))
  g.moveMobileFullscreenGesture(event(250, 150))
  g.startMobileFullscreenGesture(event(300, 150, { pointerId: 2, isPrimary: false }))
  now += 1000
  const firstRelease = event(250, 150, { touches: [{}] })
  g.handleMobilePlayerTouchEnd(firstRelease)
  assert.equal(firstRelease.prevented, true)
  now += 1000
  const lastRelease = event(300, 150, { touches: [] })
  g.handleMobilePlayerTouchEnd(lastRelease)
  assert.equal(lastRelease.prevented, true)
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'seek'), false)
  g.startMobileFullscreenGesture(event(210, 150))
  g.finishMobileFullscreenGesture(event(210, 150))
  assert.ok(calls.includes('show'), 'The next unrelated tap remains available')
})

for (const reducedMotion of [false, true]) {
  test(`close button shares swipe dismissal timing (reduced motion: ${reducedMotion})`, async t => {
    const { gestures: g, calls } = fixture(t, { mini: true, dismissible: () => true, reducedMotion })
    t.mock.timers.enable({ apis: ['setTimeout'] })
    g.dismissMobileMiniPlayer()
    assert.equal(g.mobileMiniPlayerDismissSettling.value, true)
    assert.equal(g.mobileFullscreenSwipeStyle.value['--mobile-mini-dismiss-offset'], '296.5px')
    g.dismissMobileMiniPlayer()
    t.mock.timers.tick(140)
    assert.deepEqual(calls, [], 'Dismissal waits for the rendered style update')
    await nextTick()
    if (!reducedMotion) {
      t.mock.timers.tick(139)
      assert.deepEqual(calls, [])
    }
    t.mock.timers.tick(reducedMotion ? 0 : 1)
    assert.deepEqual(calls, ['dismiss'])
  })
}

for (const [name, dynamic, time, duration, end, expected] of [
  ['VOD end', false, 30, 30, 30, 29.9],
  ['very short VOD end', false, 0.05, 0.05, 0.05, 0],
  ['VOD before the end', false, 21, 30, 30, 21],
  ['live edge', true, 30, 30, 30, 30],
  ['live DVR edge', true, 30, Infinity, 30, 30],
  ['restricted VOD range', false, 25, 30, 25, 25],
]) {
  test(`fullscreen swipe commit respects the ${name}`, () => {
    const video = { value: { currentTime: 15, duration, paused: true } }
    const seekToTimeSource = playerSource.match(/      seekToTime: (time => \{[^]*?\n      \}),/)[1]
    const seekBySecondsSource = playerSource.match(/    function seekBySeconds\([^]*?\n    }/)[0]
    const remembered = []
    const seekToTime = vm.runInNewContext(`${seekBySecondsSource}\n(${seekToTimeSource})`, {
      video,
      player: { isDynamic: () => dynamic, seekRange: () => ({ start: 0, end }) },
      isLive: { value: dynamic },
      canSeek: () => true,
      rememberSeekPosition: time => remembered.push(time),
      accumulatedSeekSeconds: 0,
    })
    seekToTime(time)
    assert.equal(video.value.currentTime, expected)
    assert.deepEqual(remembered, [expected])
    assert.equal(video.value.paused, true)
  })
}
