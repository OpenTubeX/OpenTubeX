import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRenderer, nextTick } from 'vue'
import { useMobileFullscreenGestures } from '../../src/renderer/components/FtShakaVideoPlayer/opentubex/useMobileFullscreenGestures.js'
import { TWO_FINGER_TAP_SLOP } from '../../src/renderer/helpers/player/twoFingerTap.js'

const playerSource = readFileSync(new URL('../../src/renderer/components/FtShakaVideoPlayer/FtShakaVideoPlayer.vue', import.meta.url), 'utf8')

class ElementStub {
  constructor(selector = '') { this.selector = selector }
  closest(selectors) { return this.selector && selectors.includes(this.selector) ? this : null }
}

function fixture(t, { left = 'brightness', right = 'volume', fullscreenSwipe = true, seekSwipe = () => true, mobile = true, mini = false, dismissible = () => false, reducedMotion = true, shorts = false, height = 200.5, nativeReplay = false, minimize = false, fullscreen = () => false, controls, toggleFullscreen, animationSpeed = 1, width = 400, surfaceWidth = width, seekState = () => ({ time: 60, start: 0, end: 600 }), chapterTaps = false } = {}) {
  t.mock.method(globalThis, 'setTimeout', setTimeout)
  const previous = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element, requestAnimationFrame: globalThis.requestAnimationFrame }
  const frames = []
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length }
  globalThis.Element = ElementStub
  globalThis.document = { documentElement: { dataset: { reducedMotion: reducedMotion ? 'reduce' : 'no-preference' } }, querySelector: () => ({ classList: { contains: () => mobile } }) }
  globalThis.window = { setTimeout: (...args) => setTimeout(...args) }
  const surface = new ElementStub()
  const calls = []
  const dragStartTimes = []
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
        getControls: () => controls ?? ({ getControlsContainer: () => ({ hasAttribute: () => false, getBoundingClientRect: () => ({ left: 10, width: surfaceWidth, height }) }), anySettingsMenusAreOpen: () => false, getConfig: () => ({ tapSeekDistance: 0 }), showUI: () => calls.push('show') }),
        getSeekState: seekState,
        seekToTime: time => calls.push(['seek', time]),
        isFullscreenActive: fullscreen,
        isFullscreenMetadataShown: () => false,
        isFullscreenSwipeEnabled: () => fullscreenSwipe,
        isSeekSwipeEnabled: seekSwipe,
        isPlaybackEnded: () => false,
        isPlaybackPaused: () => true,
        isPlayerSurfaceTarget: nativeReplay
          ? vm.runInNewContext(`(${playerSource.match(/function isPlayerSurfaceTarget\(target\) \{[\s\S]*?\n\}/)[0]})`, {
              Element: ElementStub, video: { value: {} }, container: { value: { hasAttribute: () => true } }
            })
          : target => target === surface,
        isScrollMiniPlayerActive: () => mini,
        isShortsPlayer: () => shorts,
        getSwipeAction: side => side === 'left' ? left : right,
        isTwoFingerTapEnabled: () => chapterTaps,
        onTwoFingerDoubleTap: direction => {
          calls.push(['chapter', direction])
          return true
        },
        getAnimationSpeedMultiplier: () => animationSpeed,
        miniPlayerDrag: {
          canDismiss: dismissible,
          dismiss: () => calls.push('dismiss'),
          begin: (restoring, startTime) => {
            dragStartTimes.push(startTime)
            if (minimize) calls.push('drag-begin')
            return minimize
          },
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
        setFullscreenMetadata() {},
        setShowUiOnPaused() {},
        showOverlayControls() {},
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
    return {
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      isPrimary: true,
      target: surface,
      preventDefault() { this.prevented = true },
      stopPropagation() {},
      stopImmediatePropagation() {},
      ...extra
    }
  }
  const paint = () => frames.splice(0).forEach(callback => callback())
  return { gestures, calls, event, captures, container, unmount, paint, dragStartTimes }
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
  const { gestures: g, event, calls, captures } = fixture(t, { left: 'volume', right: 'brightness', fullscreenSwipe: false, fullscreen: () => true })
  for (const [x, action] of [[50, 'volume'], [370, 'brightness']]) {
    calls.length = 0
    g.startMobileFullscreenGesture(event(x))
    assert.equal(g.moveMobileFullscreenGesture(event(x, 49.75)), true)
    g.finishMobileFullscreenGesture(event(x, 49.75))
    assert.deepEqual(calls, [['begin', action], ['update', 0.5], 'finish'])
    assert.equal(captures.size, 0)
    const touchEnd = event(50, 150, { timeStamp: performance.now() })
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

for (const fullscreenSwipe of [true, false]) {
  test(`a drag whose touchend the player stops still lets the controls hide (fullscreen swipe ${fullscreenSwipe})`, t => {
    const { gestures: g, event, container } = fixture(t, { fullscreenSwipe, fullscreen: () => true })
    let touchEnds = 0
    container.addEventListener('touchend', () => touchEnds++)
    // A hold without movement never showed the controls, also after a canceled moving touch
    g.startMobileFullscreenGesture(event(210))
    g.handleMobilePlayerTouchMove(event(210, 190))
    g.cancelMobileFullscreenGesture(event(210, 190))
    g.startMobileFullscreenGesture(event(210))
    g.handleStoppedPlayerTouchEnd()
    assert.equal(touchEnds, 0)
    // A short drag reaches Shaka, which shows the controls until a touchend
    g.startMobileFullscreenGesture(event(210))
    g.moveMobileFullscreenGesture(event(210, 190))
    g.handleMobilePlayerTouchMove(event(210, 190))
    g.finishMobileFullscreenGesture(event(210, 190))
    g.handleStoppedPlayerTouchEnd()
    assert.equal(touchEnds, 1)
    // The synthetic touchend passes the player's own touchend handling on its way to Shaka
    const synthetic = event(210, 190, { timeStamp: performance.now() })
    g.handleMobilePlayerTouchEnd(synthetic)
    assert.equal(synthetic.prevented, undefined)
    g.handleStoppedPlayerTouchEnd()
    assert.equal(touchEnds, 1)
  })
}

test('a swipe exits rotation fullscreen without entering native fullscreen', async t => {
  let rotationFullscreen = true
  let nativeToggles = 0
  const optionsSource = playerSource.split('} = useMobileFullscreenGestures({')[1]
  const context = vm.createContext({
    isNativeFullscreenActive: () => false,
    get androidRotationFullscreen() { return rotationFullscreen },
    exitAndroidRotationFullscreen: () => { rotationFullscreen = false },
    finishAndroidFullscreenExit() {},
    ui: { getControls: () => ({ toggleFullScreen: () => { nativeToggles++ } }) },
  })
  const fullscreen = vm.runInContext(`(${optionsSource.match(/isFullscreenActive: ([^\n]+),/)[1]})`, context)
  const toggleFullscreen = vm.runInContext(`(${optionsSource.match(/togglePlayerFullScreen: ([\s\S]*?\n {2}\}),/)[1]})`, context)
  const { gestures: g, event, paint } = fixture(t, { fullscreen, toggleFullscreen })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  assert.equal(fullscreen(), true, 'Rotation fullscreen must be recognized by gestures')
  g.startMobileFullscreenGesture(event(210, 50))
  assert.equal(g.moveMobileFullscreenGesture(event(210, 150)), true)
  g.finishMobileFullscreenGesture(event(210, 150))
  t.mock.timers.tick(0)
  await nextTick()
  paint()
  paint()
  await Promise.resolve()
  assert.equal(rotationFullscreen, false)
  assert.equal(nativeToggles, 0)
})

for (const outcome of ['released', 'new touch', 'cancel', 'not toggled']) {
  test(`fullscreen swipe carries its preview into the handoff (${outcome})`, async t => {
    let fullscreen = false
    const { gestures: g, event, calls } = fixture(t, {
      fullscreen: () => fullscreen,
      toggleFullscreen: () => {
        calls.push('fullscreen')
        fullscreen = outcome !== 'not toggled'
      },
    })
    t.mock.timers.enable({ apis: ['setTimeout'] })
    g.startMobileFullscreenGesture(event(210, 150))
    g.moveMobileFullscreenGesture(event(210, 50))
    const preview = { ...g.mobileFullscreenSwipeStyle.value }
    g.finishMobileFullscreenGesture(event(210, 50))
    assert.deepEqual(calls, ['fullscreen'], 'Toggle without returning the preview first')
    await nextTick()
    if (outcome !== 'not toggled') {
      assert.deepEqual(g.mobileFullscreenSwipeStyle.value, preview, 'Keep the preview until released')
    }
    if (outcome === 'released') {
      const { offset, scale } = g.releaseMobileFullscreenSwipe()
      assert.deepEqual(
        { '--mobile-fullscreen-swipe-offset': `${offset}px`, '--mobile-fullscreen-swipe-scale': String(scale) },
        preview,
        'Release the preview that was handed off'
      )
    }
    if (outcome === 'new touch') g.startMobileFullscreenGesture(event(210, 150))
    if (outcome === 'cancel') g.cancelMobileFullscreenGesture()
    await nextTick()
    if (outcome === 'not toggled') {
      assert.equal(g.mobileFullscreenSwipeStyle.value?.['--mobile-fullscreen-swipe-offset'], '0px', 'Spring back when fullscreen did not change')
      assert.equal(g.releaseMobileFullscreenSwipe(), null, 'A returning preview is not handed off')
      t.mock.timers.tick(0)
    }
    assert.equal(g.mobileFullscreenSwipeStyle.value, undefined)
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

test('a second finger cancels adjustments for pinch zoom, even when zoom is disabled', t => {
  const { gestures: g, event, calls, captures } = fixture(t, { fullscreen: () => true })
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
    const { gestures: g, event, calls } = fixture(t, { fullscreen: () => true, ...options })
    g.startMobileFullscreenGesture(event(50, 150, extra))
    g.moveMobileFullscreenGesture(event(50, 50, extra))
    g.finishMobileFullscreenGesture(event(50, 50, extra))
    assert.deepEqual(calls, [])
  })
}

test('playback speed works on the left with fullscreen swiping disabled', t => {
  const { gestures: g, event, calls } = fixture(t, { left: 'speed', right: 'disabled', fullscreenSwipe: false, fullscreen: () => true })
  g.startMobileFullscreenGesture(event(50))
  assert.equal(g.moveMobileFullscreenGesture(event(50, 49.75)), true)
  g.finishMobileFullscreenGesture(event(50, 49.75))
  assert.deepEqual(calls, [['begin', 'speed'], ['update', 0.5], 'finish'])
  assert.equal(calls.includes('fullscreen'), false)
})

for (const [placement, x] of [['toolbar', 50], ['center', 210]]) {
  test(`native ${placement} replay taps reach the button without gesture suppression`, t => {
    const { gestures: g, event, calls } = fixture(t, { nativeReplay: true })
    const target = new ElementStub('.shaka-play-button')
    target.classList = { contains: () => false }
    target.closest = selectors => selectors.includes('.shaka-play-button') ||
      (placement === 'toolbar' && selectors.includes('.shaka-controls-button-panel'))
      ? target
      : null
    g.startMobileFullscreenGesture(event(x, 150, { target }))
    g.finishMobileFullscreenGesture(event(x, 150, { target }))
    const touchEnd = event(x, 150, { target, timeStamp: performance.now() })
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
    const { gestures: g, event, calls, captures, dragStartTimes } = fixture(t, { minimize: true, fullscreenSwipe })
    g.startMobileFullscreenGesture(event(210, 150, { timeStamp: 1000 }))
    assert.equal(g.moveMobileFullscreenGesture(event(212, 190, { timeStamp: 1016 })), true)
    // The drag measures its progress, and so its release speed, from where the finger went down.
    assert.deepEqual(dragStartTimes, [1000])
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

for (const x of [50]) {
  test(`inline side swipes at ${x}px enter fullscreen and minimize instead of adjusting`, async t => {
    const { gestures: g, event, calls, paint } = fixture(t, { minimize: true })
    t.mock.timers.enable({ apis: ['setTimeout'] })
    g.startMobileFullscreenGesture(event(x, 150))
    assert.equal(g.moveMobileFullscreenGesture(event(x, 50)), true)
    g.finishMobileFullscreenGesture(event(x, 50))
    t.mock.timers.tick(0)
    await nextTick()
    paint()
    paint()
    await Promise.resolve()
    assert.deepEqual(calls, ['fullscreen'])

    calls.length = 0
    g.startMobileFullscreenGesture(event(x, 150))
    assert.equal(g.moveMobileFullscreenGesture(event(x, 250)), true)
    g.finishMobileFullscreenGesture(event(x, 250))
    assert.deepEqual(calls, ['drag-begin', ['drag-move', 0, 100], ['drag-finish', true]])
  })
}

for (const distance of [24, 120]) {
  test(`upward mini-player swipe ${distance}px restores or cancels`, t => {
    const { gestures: g, event, calls } = fixture(t, { mini: true, minimize: true })
    g.startMobileFullscreenGesture(event(210, 400))
    assert.equal(g.moveMobileFullscreenGesture(event(210, 400 - distance)), true)
    assert.equal(g.finishMobileFullscreenGesture(event(210, 400 - distance)), true)
    assert.deepEqual(calls, ['drag-begin', ['drag-move', 0, -distance], ['drag-finish', distance >= 64]])
  })
}

test('revealing Watch preserves a drag and completed dismissal survives visibility changes, but changing video cancels', () => {
  const start = playerSource.indexOf('watch([isActiveTab, scrollMiniPlayerActive, mobileAdjustmentsVisible, () => props.videoId]')
  const end = playerSource.indexOf('\nwatch(', start + 10)
  let changed
  const resets = []
  const dragging = { value: {} }
  const dismissing = { value: false }
  vm.runInNewContext(playerSource.slice(start, end), {
    watch: (_sources, callback) => { changed = callback },
    isActiveTab: {},
    scrollMiniPlayerActive: {},
    mobileAdjustmentsVisible: {},
    props: { videoId: 'video' },
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

for (const distance of [24, 64]) {
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

for (const reason of ['reversed', 'second finger', 'unavailable']) {
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

for (const selector of ['.mobileMiniBarDismiss', '.mobileMiniBarPlayback']) {
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
    assert.deepEqual(g.mobileSeekPreview.value, { time })
    assert.deepEqual(calls, [], 'Preview must not seek or adjust volume/brightness')
    assert.equal(captures.size, 1)
    assert.equal(g.moveMobileFullscreenGesture(event(endX, 250)), true, 'Seeking stays locked despite vertical drift')
    assert.equal(g.mobileFullscreenSwiping.value, false)
    assert.equal(g.finishMobileFullscreenGesture(event(endX, 250)), true)
    assert.deepEqual(calls, [['seek', time]])
    assert.equal(g.mobileSeekPreview.value, null)
    assert.equal(captures.size, 0)
    const touchEnd = event(endX, 250, { timeStamp: performance.now() })
    g.handleMobilePlayerTouchEnd(touchEnd)
    assert.equal(touchEnd.prevented, true)
    g.handleMobilePlayerSurfaceClick(event(endX, 250))
    assert.deepEqual(calls, [['seek', time]], 'Release must not toggle controls or seek again')
  })
}

for (const [name, range, deltaX, expected] of [
  ['start', { time: 25, start: 20, end: 620 }, -100, 20],
  ['end', { time: 615, start: 20, end: 620 }, 100, 620],
  ['short video', { time: 10, start: 0, end: 40 }, 100, 20],
]) {
  test(`horizontal seek respects the ${name} with fractional player geometry`, t => {
    const { gestures: g, event, calls } = fixture(t, { fullscreen: () => true, width: 400.5, seekState: () => range })
    g.startMobileFullscreenGesture(event(210, 150))
    g.moveMobileFullscreenGesture(event(210 + deltaX, 150))
    assert.deepEqual(g.mobileSeekPreview.value, { time: expected })
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

test('an open settings menu leaves horizontal swipes to the menu', t => {
  const controls = {
    getControlsContainer: () => ({ hasAttribute: () => true, getBoundingClientRect: () => ({ left: 10, width: 400, height: 200.5 }) }),
    anySettingsMenusAreOpen: () => true,
  }
  const { gestures: g, event, calls } = fixture(t, { fullscreen: () => true, controls })
  g.startMobileFullscreenGesture(event(210, 150))
  assert.equal(g.moveMobileFullscreenGesture(event(310, 150)), false)
  g.finishMobileFullscreenGesture(event(310, 150))
  assert.equal(g.mobileSeekPreview.value, null)
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

for (const reducedMotion of [false]) {
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
    const seekToTimeSource = playerSource.match(/ {2}seekToTime: (time => \{[^]*?\n {2}\}),/)[1]
    const seekBySecondsSource = playerSource.match(/\nfunction seekBySeconds\([^]*?\n}/)[0]
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

// Sends both fingers of a two-finger tap through the gesture handlers as the
// player routes them. Each finger moves by `drift` before lifting.
function twoFingerTap(g, event, { x = 370, start = 0, duration = 120, drift = 0, gap = 40 } = {}) {
  const fingers = [{ pointerId: 1, isPrimary: true, x: x - 30 }, { pointerId: 2, isPrimary: false, x: x + 30 }]
  const touchEnds = []
  fingers.forEach((finger, index) => {
    const down = event(finger.x, 100, { ...finger, type: 'pointerdown', timeStamp: start + index * gap })
    g.trackMobileTwoFingerTap(down)
    g.startMobileFullscreenGesture(down)
  })
  for (const finger of fingers) {
    const move = event(finger.x + drift, 100, { ...finger, type: 'pointermove', timeStamp: start + duration / 2 })
    g.trackMobileTwoFingerTap(move)
    g.moveMobileFullscreenGesture(move)
  }
  fingers.forEach((finger, index) => {
    const up = event(finger.x + drift, 100, { ...finger, type: 'pointerup', timeStamp: start + duration - (1 - index) * 10 })
    g.trackMobileTwoFingerTap(up)
    g.finishMobileFullscreenGesture(up)
    const touchEnd = event(finger.x + drift, 100, { timeStamp: performance.now(), touches: [] })
    g.handleMobilePlayerTouchEnd(touchEnd)
    touchEnds.push(touchEnd.prevented === true)
  })
  return touchEnds
}

for (const [x, direction] of [[370, 1], [50, -1]]) {
  test(`a two-finger double tap on the ${direction > 0 ? 'right' : 'left'} skips chapters without toggling controls`, t => {
    const { gestures: g, event, calls } = fixture(t, { chapterTaps: true })
    t.mock.timers.enable({ apis: ['setTimeout'] })
    assert.deepEqual(twoFingerTap(g, event, { x }), [true, true])
    assert.deepEqual(twoFingerTap(g, event, { x, start: 300 }), [true, true])
    assert.deepEqual(calls, [['chapter', direction]])
    t.mock.timers.tick(1000)
    assert.deepEqual(calls, [['chapter', direction]])
  })
}

// The first tap lifts its last finger at 120 ms.
for (const [name, tap, secondStart, shows] of [
  ['a pinch', { drift: TWO_FINGER_TAP_SLOP + 1 }, 300, 0],
  ['a slow two-finger press', { duration: 451 }, 600, 0],
  ['a center two-finger tap', { x: 210 }, 300, 2],
  ['two-finger taps too far apart', {}, 471, 2],
]) {
  test(`${name} does not skip chapters`, t => {
    const { gestures: g, event, calls } = fixture(t, { chapterTaps: true })
    t.mock.timers.enable({ apis: ['setTimeout'] })
    twoFingerTap(g, event, tap)
    t.mock.timers.tick(secondStart - 120)
    twoFingerTap(g, event, { ...tap, start: secondStart })
    t.mock.timers.tick(1000)
    assert.deepEqual(calls, Array(shows).fill('show'))
  })
}

test('two-finger taps keep their previous handling when chapter taps are unavailable', t => {
  const { gestures: g, event, calls } = fixture(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  assert.deepEqual(twoFingerTap(g, event), [false, false])
  assert.deepEqual(twoFingerTap(g, event, { start: 300 }), [false, false])
  t.mock.timers.tick(1000)
  assert.deepEqual(calls, [])
})

test('a second tap that came in time still pairs after a busy main thread ran the lone-tap timer', t => {
  const { gestures: g, event, calls } = fixture(t, { chapterTaps: true })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  twoFingerTap(g, event)
  t.mock.timers.tick(400)
  twoFingerTap(g, event, { start: 300 })
  assert.deepEqual(calls, ['show', ['chapter', 1]])
})

test('a third finger cancels a two-finger double tap', t => {
  const { gestures: g, event, calls } = fixture(t, { chapterTaps: true })
  twoFingerTap(g, event)
  g.trackMobileTwoFingerTap(event(340, 100, { pointerId: 1, type: 'pointerdown', timeStamp: 300 }))
  g.trackMobileTwoFingerTap(event(400, 100, { pointerId: 2, isPrimary: false, type: 'pointerdown', timeStamp: 310 }))
  // Video zoom defers its pinch only while the fingers can still form a tap.
  assert.equal(g.isMobileTwoFingerTapCandidate(), true)
  g.trackMobileTwoFingerTap(event(380, 140, { pointerId: 3, isPrimary: false, type: 'pointerdown', timeStamp: 320 }))
  assert.equal(g.isMobileTwoFingerTapCandidate(), false)
  for (const [pointerId, x, y] of [[1, 340, 100], [2, 400, 100], [3, 380, 140]]) {
    g.trackMobileTwoFingerTap(event(x, y, { pointerId, type: 'pointerup', timeStamp: 400 }))
  }
  assert.deepEqual(calls, [])
})
