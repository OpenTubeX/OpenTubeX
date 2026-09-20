import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { getScrollMiniInlineLayoutHeight } from '../../src/renderer/helpers/scrollMiniPlayer.js'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/opentubex/useScrollMiniPlayer.js', import.meta.url), 'utf8')
const dragSource = source.slice(source.indexOf('  let inlineDrag ='), source.indexOf('  function updateScrollMiniVideoAspectRatio'))

function fixture({ reducedMotion = false, available = true, restoring = false, finishRejects = false } = {}) {
  let reads = 0
  let navigations = 0
  let previewProgress = 0
  let activated = false
  let deactivated = false
  const stash = { value: 'left' }
  let destination = null
  const frames = new Map()
  const animations = []
  const events = []
  const style = { removeProperty(key) { delete this[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] } }
  const from = restoring
    ? { x: 172.25, y: 570.75, width: 210.5, height: 118.40625 }
    : { x: 10.25, y: 80.5, width: 390.5, height: 219.65625 }
  const to = { left: 172.25, top: 570.75, width: 210.5, height: 118.40625 }
  const container = { value: {
    style, offsetHeight: 219.65625,
    setAttribute() {}, removeAttribute() {},
    getBoundingClientRect() { reads++; return from },
    dispatchEvent(event) { events.push(event.detail) },
  } }
  const methods = vm.runInNewContext(`${dragSource}\n({ beginScrollMiniPlayerDrag, moveScrollMiniPlayerDrag, finishScrollMiniPlayerDrag, cancelScrollMiniPlayerDrag })`, {
    container,
    performance: { now: () => 0 },
    SCROLL_MINI_LAYOUT_ANIMATION_DURATION_MS: 300,
    getAnimationSpeedMultiplier: () => 1,
    store: { getters: { getAnimationSpeed: 1 } },
    watchNavigation: {
      detached: { value: true }, minimize() {},
      beginMinimizePreview() { navigations++ },
      beginRestorePreview() { return true },
      updateMinimizePreview(progress) { previewProgress = progress },
      async finishMinimizePreview(commit) {
        if (finishRejects) throw new Error('handoff failed')
        if (!commit) navigations--
      },
      clearMinimizePreview() {},
    },
    nextTick: async callback => callback(),
    scrollMiniPlaceholder: { value: { getBoundingClientRect: () => ({ left: 0, top: 80, width: 390, height: 219.375 }) } },
    scrollMiniPlaceholderHeight: { value: 0 },
    scrollMiniPlayerDragStyle: { value: null },
    scrollMiniPlayerActive: { value: restoring },
    scrollMiniVideoAspectRatio: { value: 16 / 9 },
    canUseScrollMiniPlayerBase: () => available,
    cancelScrollMiniPlayerLayoutAnimation() {},
    updateScrollMiniVideoAspectRatio() {},
    clampScrollMiniPlayerRect: rect => rect,
    scrollMiniPlayerStashedSide: stash,
    scrollMiniPlayerRestoreRect: null,
    applyScrollMiniPlayerRect(rect) { destination = rect },
    getSavedScrollMiniPlayerRect: () => to,
    reanchorScrollMiniPlayerRect: rect => rect,
    requestAnimationFrame(callback) { frames.set(1, callback); return 1 },
    cancelAnimationFrame(id) { frames.delete(id) },
    CustomEvent: class { constructor(name, { detail }) { this.detail = detail } },
    activateScrollMiniPlayer() { activated = true },
    deactivateScrollMiniPlayer() { deactivated = true },
    updateScrollMiniPlayer() {},
    isReducedMotionEnabled: () => reducedMotion,
    scrollMiniPlayerAnimating: { value: false },
    scrollMiniLayoutAnimationSequence: 0,
    animateScrollMiniPlayerLayout: (...args) => { animations.push(args) },
    console,
  })
  return { methods, style, frames, events, animations, stash, progress: () => previewProgress, destination: () => destination, reads: () => reads, navigations: () => navigations, activated: () => activated, deactivated: () => deactivated }
}

test('drag batches pointer samples into one transform without reading layout per move', () => {
  const f = fixture()
  assert.equal(f.methods.beginScrollMiniPlayerDrag(), true)
  for (let y = 1; y <= 100; y++) f.methods.moveScrollMiniPlayerDrag(12.5, y)
  assert.equal(f.frames.size, 1)
  assert.equal(f.reads(), 1)
  f.frames.get(1)()
  assert.match(f.style.transform, /^translate\([\d.]+px, [\d.]+px\) scale\(0\.\d+, 0\.\d+\)$/)
  assert.equal(f.reads(), 1)
  assert.equal(f.progress(), 1)
  assert.equal(f.events[0], true)
})

test('cancellation removes pending frames and restores the original player without navigation', async () => {
  const f = fixture()
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(0, 30)
  const finished = f.methods.finishScrollMiniPlayerDrag(false)
  await Promise.resolve()
  const frame = f.frames.get(1)
  f.frames.delete(1)
  frame(300)
  await finished
  assert.equal(f.frames.size, 0)
  assert.equal(f.style.transform, undefined)
  assert.equal(f.style.willChange, undefined)
  assert.equal(f.navigations(), 0)
  assert.equal(f.events.at(-1), false)
  assert.equal(f.animations.length, 0)
})

test('committing minimizes once and reduced motion skips the release animation', async () => {
  const f = fixture({ reducedMotion: true })
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(0, 200)
  await f.methods.finishScrollMiniPlayerDrag(true)
  await f.methods.finishScrollMiniPlayerDrag(true)
  assert.equal(f.navigations(), 1)
  assert.equal(f.activated(), true)
  assert.equal(f.stash.value, null)
  assert.equal(f.destination().left, 172.25)
  assert.equal(f.animations.length, 0)
  assert.equal(f.style.transform, undefined)
})

test('failed preview handoff still clears inline drag state', async () => {
  const f = fixture({ reducedMotion: true, finishRejects: true })
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(0, 200)
  await assert.rejects(f.methods.finishScrollMiniPlayerDrag(true), /handoff failed/)
  assert.equal(f.style.transform, undefined)
  assert.equal(f.style.willChange, undefined)
  assert.equal(f.events.at(-1), false)
  assert.equal(f.methods.beginScrollMiniPlayerDrag(), true)
})

test('unavailable playback does not capture a drag', () => {
  const f = fixture({ available: false })
  assert.equal(f.methods.beginScrollMiniPlayerDrag(), false)
  assert.equal(f.reads(), 0)
  assert.equal(f.events.length, 0)
})

test('navigation can hide the watch view without losing the drag handoff dimensions', () => {
  const measure = source.match(/function getScrollMiniPlaceholderLayoutHeight\(\) \{[\s\S]*?\n  \}/)[0]
  const height = vm.runInNewContext(`(${measure})()`, {
    inlineDrag: { from: { width: 412.19049, height: 231.857147 } },
    container: { value: { offsetWidth: 0, offsetHeight: 0 } },
    lastKnownInlinePlayerHeight: 232,
    getScrollMiniInlineLayoutHeight,
  })
  assert.ok(height > 231 && height < 233)
})


test('Watch starts fading immediately, independently of the mini-player destination', () => {
  const f = fixture()
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(0, 24)
  f.frames.get(1)()
  assert.equal(f.progress(), 0.25)
})


for (const commit of [true, false]) {
  test(`upward drag expands toward Watch and ${commit ? 'restores' : 'keeps'} the mini player`, async () => {
    const f = fixture({ restoring: true, reducedMotion: true })
    assert.equal(f.methods.beginScrollMiniPlayerDrag(true), true)
    f.methods.moveScrollMiniPlayerDrag(0, -24)
    f.frames.get(1)()
    assert.equal(f.progress(), 1 - 24 / 490.75)
    await f.methods.finishScrollMiniPlayerDrag(commit)
    assert.equal(f.deactivated(), commit)
    assert.equal(f.style.transform, undefined)
    assert.equal(f.events.at(-1), false)
  })
}

test('drag follows the same fixed path regardless of sideways finger movement', () => {
  const f = fixture()
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(0, 100)
  f.frames.get(1)()
  const path = f.style.transform
  f.methods.moveScrollMiniPlayerDrag(95, 100)
  f.frames.get(1)()
  assert.equal(f.style.transform, path)
})

test('drag cannot overshoot the saved mini-player endpoint', () => {
  const f = fixture()
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(0, 1000)
  f.frames.get(1)()
  const endpoint = f.style.transform
  f.methods.moveScrollMiniPlayerDrag(0, 1500)
  f.frames.get(1)()
  assert.equal(f.style.transform, endpoint)
})

test('return keeps the preview in place until the player reaches the inline endpoint', async () => {
  const f = fixture({ restoring: true })
  f.methods.beginScrollMiniPlayerDrag(true)
  f.methods.moveScrollMiniPlayerDrag(0, -24)
  const finished = f.methods.finishScrollMiniPlayerDrag(true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.deactivated(), false)
  const before = f.style.transform
  let frame = f.frames.get(1)
  f.frames.delete(1)
  frame(-1)
  assert.equal(f.style.transform, before, 'A frame timestamp before pointerup cannot move backward')
  frame = f.frames.get(1)
  f.frames.delete(1)
  frame(150)
  assert.equal(f.deactivated(), false)
  frame = f.frames.get(1)
  f.frames.delete(1)
  frame(300)
  await finished
  assert.equal(f.deactivated(), true)
  assert.equal(f.style.transform, undefined)
  assert.equal(f.style.borderRadius, undefined)
})

test('vertical player displacement matches the finger before reaching its endpoint', () => {
  const f = fixture()
  f.methods.beginScrollMiniPlayerDrag()
  f.methods.moveScrollMiniPlayerDrag(80, 100)
  f.frames.get(1)()
  const y = Number(f.style.transform.match(/translate\([^,]+, ([\d.]+)px/)[1])
  assert.ok(Math.abs(y - 100) < 0.001, `Player moved ${y}px for a 100px swipe`)
})

test('return button uses the same preview and continuous path as an upward swipe', () => {
  const returnSource = source.slice(source.indexOf('  function scrollMiniScrollToTop('), source.indexOf('  function dismissCrossTabMiniPlayer('))
  const calls = []
  vm.runInNewContext(`${returnSource}\nscrollMiniScrollToTop()`, {
    scrollMiniPlayerDetached: { value: true }, tabId: 'tab',
    watchNavigation: { detached: { value: true }, tabPresented: { value: true }, returnToVideo: () => calls.push('navigate') },
    beginScrollMiniPlayerDrag: restoring => { calls.push(['begin', restoring]); return true },
    finishScrollMiniPlayerDrag: commit => calls.push(['finish', commit]),
    process: { env: { IS_CAPACITOR: true } },
    getCapacitorTabService: () => ({ activateTab: () => calls.push('activate') })
  })
  assert.equal(JSON.stringify(calls), JSON.stringify([['begin', true], ['finish', true]]))
})

for (const navigatedAway of [false, true]) {
  test(`close ${navigatedAway ? 'disposes a retained page' : 'only hides a player from another tab'}`, () => {
    const handler = source.slice(source.indexOf('  function dismissCrossTabMiniPlayer('), source.indexOf('  async function scrollMiniTogglePlayPause('))
    const dismissed = { value: false }
    let disposals = 0
    vm.runInNewContext(`${handler}\ndismissCrossTabMiniPlayer()`, {
      scrollMiniPlayerDetached: { value: true },
      scrollMiniPlayerDismissed: dismissed,
      watchNavigation: { detached: { value: navigatedAway }, dismiss: () => { disposals++ } }
    })
    assert.equal(disposals, navigatedAway ? 1 : 0)
    assert.equal(dismissed.value, !navigatedAway)
  })
}
