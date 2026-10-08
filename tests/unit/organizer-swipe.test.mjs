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
      document: { documentElement: { dataset: { reducedMotion: reduced ? 'reduce' : 'off' } } },
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
