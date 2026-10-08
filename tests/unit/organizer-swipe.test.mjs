import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/helpers/organizerSwipe.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/m, '').replaceAll('export function', 'function')
const context = vm.createContext({})
vm.runInContext(source, context)

test('organizer progress follows the pull, clamps reversal and bounds full travel', () => {
  assert.equal(context.organizerSwipeProgress(0, 800), 0)
  assert.equal(context.organizerSwipeProgress(80, 800), 0.25)
  assert.equal(context.organizerSwipeProgress(-40, 800), 0)
  assert.equal(context.organizerSwipeProgress(500, 800), 1)
  assert.equal(context.organizerSwipeProgress(90, 400), 0.5)
})

test('organizer release accepts deliberate pulls and flicks but rejects jitter and short slow pulls', () => {
  assert.equal(context.shouldOpenSwipedOrganizer(120, 800, 1000), true)
  assert.equal(context.shouldOpenSwipedOrganizer(50, 800, 80), true)
  assert.equal(context.shouldOpenSwipedOrganizer(20, 800, 10), false)
  assert.equal(context.shouldOpenSwipedOrganizer(50, 800, 500), false)
  assert.equal(context.shouldOpenSwipedOrganizer(0, 800, 500), false)
})

for (const reduced of [false, true]) {
  test(`page animation reaches the exact card bounds and cleans up (reduced motion: ${reduced})`, async () => {
    const animations = []
    const classes = new Set()
    const animate = (frames, options) => {
      const animation = { frames, options, pause() {}, cancel() { this.cancelled = true }, finished: Promise.resolve() }
      animations.push(animation)
      return animation
    }
    const ctx = vm.createContext({
      document: { documentElement: { dataset: { reducedMotion: reduced ? 'reduce' : 'off' } }, querySelector: () => null },
      window: { innerHeight: 800 },
      matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ borderRadius: '0px' }),
      applyAnimationSpeed: animation => animation, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    })
    vm.runInContext(source, ctx)
    const page = { animate, classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
      getBoundingClientRect: () => ({ left: 0, top: 80.5, width: 375.5, height: 700.25 }) }
    const preview = { getBoundingClientRect: () => ({ left: 16.25, top: 180.75, width: 160.5, height: 90.28125 }) }
    const transition = ctx.createOrganizerSwipeAnimation(page, preview, { animate })
    transition.update(0.4)
    assert.ok(animations.every(animation => animation.currentTime === 400))
    if (!reduced) {
      assert.ok(animations[0].frames[1].transform.includes('translate(16.25px, 100.25px)'))
      assert.ok(animations[0].frames[1].transform.includes(`scale(${160.5 / 375.5})`))
    }
    await transition.finish(true)
    assert.ok(animations.slice(0, reduced ? 1 : 2).every(animation => animation.currentTime === 1000))
    transition.dispose()
    assert.equal(classes.size, 0)
    assert.ok(animations.every(animation => animation.cancelled))
    transition.update(0.1)
    assert.equal(animations[0].currentTime, 1000, 'cleanup cannot be undone by an asynchronous continuation')
  })
}

for (const zoom of [1, 1.25]) {
  test(`scrolled page keeps the currently visible region throughout the morph at ${zoom}x scale`, () => {
    const animations = []
    const from = { left: 0, top: -620.5 * zoom, width: 375.5 * zoom, height: 2400.25 * zoom }
    const to = { left: 16.25 * zoom, top: 180.75 * zoom, width: 160.5 * zoom, height: 90.28125 * zoom }
    const headerBottom = 80.5 * zoom
    const animate = frames => {
      animations.push(frames)
      return { pause() {} }
    }
    const ctx = vm.createContext({
      document: {
        documentElement: { dataset: { reducedMotion: 'off' } },
        querySelector: () => ({ getBoundingClientRect: () => ({ bottom: headerBottom }) }),
      },
      window: { innerHeight: 800 * zoom },
      matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ borderRadius: '8px' }),
    })
    vm.runInContext(source, ctx)
    ctx.createOrganizerSwipeAnimation({ animate, classList: { add() {} }, getBoundingClientRect: () => from },
      { getBoundingClientRect: () => to }, { animate })
    const [start, end] = animations[0]
    const visibleTop = headerBottom - from.top
    assert.ok(start.clipPath.startsWith(`inset(${visibleTop}px `), 'content hidden above the header must stay clipped from the first frame')
    const clip = end.clipPath.match(/inset\(([-\d.]+)px 0 ([-\d.]+)px/)
    assert.ok(clip)
    const transform = end.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/)
    assert.ok(transform)
    const top = Number(clip[1]), bottom = Number(clip[2]), scale = Number(transform[3])
    assert.ok(Math.abs(from.top + Number(transform[2]) + top * scale - to.top) < 0.001)
    assert.ok(Math.abs((from.height - top - bottom) * scale - to.height) < 0.001)
    assert.equal(top, visibleTop, 'the final card must show the same page region as the initial frame')
  })
}
