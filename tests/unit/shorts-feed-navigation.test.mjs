import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick } from 'vue'

const listeners = { window: new Map(), document: new Map() }
const recordListeners = target => ({
  addEventListener: (type, listener, options) => target.set(type, { listener, options }),
  removeEventListener: (type, listener) => {
    if (target.get(type)?.listener === listener) target.delete(type)
  },
})
globalThis.window = {
  scrollY: 0,
  scrollTo({ top }) { this.scrollY = top },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  ...recordListeners(listeners.window),
}
globalThis.document = {
  documentElement: { dataset: { reducedMotion: 'reduce' } },
  ...recordListeners(listeners.document),
}
const frames = []
globalThis.requestAnimationFrame = callback => frames.push(callback)

const { createShortsFeedNavigation } = await import('../../src/renderer/views/Watch/shortsFeedNavigation.js')

/** A viewport whose Short and swipe preview animate */
function viewportFixture() {
  const animations = []
  const surface = className => ({
    classList: { contains: name => name === className },
    animate(keyframes) {
      let finish
      const animation = {
        keyframes,
        cancelled: false,
        finished: new Promise((resolve, reject) => { finish = { resolve, reject } }),
        updatePlaybackRate() {},
        cancel() {
          this.cancelled = true
          finish.reject(new Error('cancelled'))
        },
        finish: () => finish.resolve(),
      }
      animation.finished.catch(() => {})
      animations.push(animation)
      return animation
    },
  })
  return {
    animations,
    getBoundingClientRect: () => ({ height: 600 }),
    querySelectorAll: () => [surface('videoPlayer'), surface('shortsSwipePreview')],
  }
}

function fixture({ index = 1, active = true, presented = true, tabSelected = true } = {}) {
  const opened = []
  const viewport = viewportFixture()
  const options = {
    active, presented, tabSelected, panelOpen: false,
    feed: [{ videoId: 'previous' }, { videoId: 'current' }, { videoId: 'next' }],
    index,
  }
  const navigation = createShortsFeedNavigation({
    isActive: () => options.active,
    getFeed: () => options.feed,
    getIndex: () => options.index,
    isPresented: () => options.presented,
    isTabSelected: () => options.tabSelected,
    isPanelOpen: () => options.panelOpen,
    getThumbnailUrl: short => `${short.videoId}.jpg`,
    getViewport: () => viewport,
    openShort: short => opened.push(short.videoId),
  })
  return { navigation, opened, options, viewport }
}

function keydown(key, overrides = {}) {
  let prevented = false
  return {
    key,
    target: { tagName: 'DIV', closest: () => null },
    preventDefault: () => { prevented = true },
    get prevented() { return prevented },
    ...overrides,
  }
}

function pointer(type, clientY, overrides = {}) {
  const event = {
    type,
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    clientX: 100,
    clientY,
    target: { closest: () => null },
    currentTarget: { setPointerCapture() {} },
    preventDefault() {},
    stopPropagation() {},
    ...overrides,
  }
  return event
}

test.beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  window.scrollY = 0
  frames.length = 0
})

test('opens the neighboring Short with a transition preview and briefly ignores repeats', t => {
  const { navigation, opened } = fixture()
  navigation.navigate(-1)
  assert.deepEqual(opened, ['previous'])
  assert.equal(navigation.state.transitionPreview, 'previous.jpg')
  assert.equal(navigation.state.transitionDirection, -1)
  assert.equal(navigation.lockedUntil, Date.now() + 300)

  navigation.navigate(1)
  t.mock.timers.tick(299)
  navigation.navigate(1)
  assert.deepEqual(opened, ['previous'], 'navigation stays locked for 300 ms')
  t.mock.timers.tick(1)
  navigation.navigate(1)
  assert.deepEqual(opened, ['previous', 'next'])

  navigation.finishTransition()
  assert.equal(navigation.state.transitionPreview, '')
  assert.equal(navigation.state.transitionDirection, 0)
})

test('does not navigate past the feed or outside a Shorts feed', () => {
  const last = fixture({ index: 2 })
  last.navigation.navigate(1)
  assert.deepEqual(last.opened, [])
  const inactive = fixture({ active: false })
  inactive.navigation.navigate(1)
  assert.deepEqual(inactive.opened, [])
})

test('arrow and page keys navigate unless the user is typing or using another surface', () => {
  const { navigation, opened, options } = fixture()
  navigation.addListeners()
  const { listener, options: listenerOptions } = listeners.document.get('keydown')
  assert.equal(listenerOptions, true, 'captures keys before the player handles them')

  for (const event of [
    keydown('ArrowDown', { shiftKey: true }),
    keydown('ArrowDown', { ctrlKey: true }),
    keydown('ArrowDown', { target: { tagName: 'INPUT', closest: () => null } }),
    keydown('ArrowDown', { target: { tagName: 'DIV', isContentEditable: true, closest: () => null } }),
    keydown('ArrowDown', { target: { tagName: 'DIV', closest: selector => selector.includes('dialog') ? {} : null } }),
    keydown('ArrowLeft'),
  ]) {
    listener(event)
    assert.equal(event.prevented, false)
  }
  options.panelOpen = true
  listener(keydown('ArrowDown'))
  options.panelOpen = false
  options.presented = false
  listener(keydown('ArrowDown'))
  options.presented = true
  assert.deepEqual(opened, [])

  const next = keydown('PageDown')
  listener(next)
  assert.equal(next.prevented, true)
  assert.deepEqual(opened, ['next'])

  navigation.removeListeners()
  assert.equal(listeners.document.has('keydown'), false)
  assert.equal(listeners.window.has('scroll'), false)
})

test('the mouse wheel navigates outside panels after a deliberate movement', () => {
  const { navigation, opened } = fixture()
  let prevented = 0
  const wheel = (deltaY, panel = false) => navigation.handleWheel({
    deltaY,
    target: { closest: () => panel ? {} : null },
    preventDefault: () => { prevented++ },
  })
  wheel(19)
  wheel(100, true)
  assert.deepEqual(opened, [])
  wheel(-40)
  assert.deepEqual(opened, ['previous'])
  assert.equal(prevented, 1)
})

test('scrolling the document down advances once and resets the scroll range', () => {
  const { navigation, opened, options } = fixture()
  navigation.addListeners()
  const scroll = listeners.window.get('scroll')
  assert.deepEqual(scroll.options, { passive: true })

  window.scrollY = 3
  scroll.listener()
  assert.deepEqual(opened, [], 'ignores small movements')

  window.scrollY = 40
  scroll.listener()
  assert.deepEqual(opened, ['next'])
  assert.equal(window.scrollY, 0, 'resets the document so the next movement can scroll again')
  assert.equal(navigation.scrollResetPending, true)

  // The reset itself scrolls, which must not navigate back.
  scroll.listener()
  assert.equal(navigation.scrollResetPending, false)
  assert.deepEqual(opened, ['next'])

  options.tabSelected = false
  window.scrollY = 80
  scroll.listener()
  options.tabSelected = true
  window.scrollY = 70
  scroll.listener()
  assert.deepEqual(opened, ['next'], 'a background tab only updates the baseline, and moving up does not navigate')
  navigation.removeListeners()
})

test('restored scroll positions after activating the tab do not navigate', t => {
  const { navigation, opened } = fixture()
  navigation.addListeners()
  const scroll = listeners.window.get('scroll').listener
  t.mock.timers.tick(300)
  window.scrollY = 120
  navigation.resumeScrollTracking()
  assert.equal(frames.length, 1)
  frames.shift()()
  scroll()
  assert.deepEqual(opened, [])
  navigation.removeListeners()
})

test('a touch swipe follows the finger, previews the neighbor and settles into it', async () => {
  const { navigation, opened, viewport } = fixture()
  navigation.handlePointerDown(pointer('pointerdown', 400))
  assert.equal(navigation.state.height, 600)
  navigation.handlePointerMove(pointer('pointermove', 395))
  assert.equal(navigation.state.pointer.dragging, false, 'small movements do not start a swipe')
  navigation.handlePointerMove(pointer('pointermove', 320))
  assert.equal(navigation.state.pointer.dragging, true)
  assert.equal(navigation.state.preview, 'next.jpg')
  assert.equal(navigation.state.offset, -80)

  navigation.handlePointerUp(pointer('pointerup', 320))
  assert.equal(navigation.state.settling, true)
  assert.equal(navigation.state.offset, -600)
  await nextTick()
  assert.equal(viewport.animations.length, 2)
  assert.deepEqual(viewport.animations[1].keyframes.at(-1), { transform: 'translateY(0px)' },
    'the preview slides into place')
  viewport.animations.forEach(animation => animation.finish())
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(opened, ['next'])
  assert.equal(navigation.state.settling, false)
  assert.equal(navigation.state.preview, '')
  assert.equal(navigation.state.transitionDirection, 0)

  let clickPrevented = false
  navigation.handleClick({ detail: 1, preventDefault: () => { clickPrevented = true }, stopPropagation() {} })
  assert.equal(clickPrevented, true, 'the click that ends a swipe does not reach the player')
})

test('short, horizontal and cancelled swipes return without navigating', async () => {
  const { navigation, opened, viewport } = fixture()
  navigation.handlePointerDown(pointer('pointerdown', 400))
  navigation.handlePointerMove(pointer('pointermove', 360))
  navigation.handlePointerUp(pointer('pointerup', 360))
  await nextTick()
  viewport.animations.forEach(animation => animation.finish())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(navigation.state.offset, 0)

  navigation.handlePointerDown(pointer('pointerdown', 400))
  navigation.handlePointerMove(pointer('pointermove', 395, { clientX: 140 }))
  assert.equal(navigation.state.pointer, null, 'a horizontal movement is not a swipe')

  navigation.handlePointerDown(pointer('pointerdown', 400))
  navigation.handlePointerMove(pointer('pointermove', 300))
  navigation.resetSwipe()
  assert.equal(navigation.state.pointer, null)
  assert.deepEqual(opened, [])
})

test('swipes only start from a primary touch outside controls and panels', () => {
  const { navigation, options } = fixture()
  navigation.handlePointerDown(pointer('pointerdown', 400, { pointerType: 'mouse' }))
  navigation.handlePointerDown(pointer('pointerdown', 400, { target: { closest: selector => selector.includes('button') ? {} : null } }))
  options.panelOpen = true
  navigation.handlePointerDown(pointer('pointerdown', 400))
  assert.equal(navigation.state.pointer, null)
})

test('resetting cancels a settling swipe before it navigates', async () => {
  const { navigation, opened, viewport } = fixture()
  navigation.handlePointerDown(pointer('pointerdown', 400))
  navigation.handlePointerMove(pointer('pointermove', 300))
  navigation.handlePointerUp(pointer('pointerup', 300))
  await nextTick()
  navigation.resetSwipe()
  assert.equal(viewport.animations.every(animation => animation.cancelled), true)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(opened, [])
  assert.equal(navigation.state.settling, false)
})
