import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/helpers/organizerSwipe.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '').replaceAll('export function', 'function')
const regionSource = readFileSync(new URL('../../src/renderer/helpers/capacitorTabPreviewRegion.js', import.meta.url), 'utf8')
  .replaceAll('export function', 'function')
const context = vm.createContext({})
vm.runInContext(source, context)

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
      window: { innerWidth: 375.5, innerHeight: 800 },
      matchMedia: () => ({ matches: false }),
      getComputedStyle: () => ({ borderTopLeftRadius: '6px' }),
      applyAnimationSpeed: animation => animation,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame() {},
    })
    vm.runInContext(regionSource + source, ctx)
    const page = {
      animate,
      classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
      getBoundingClientRect: () => ({ left: 0, top: 80.5, width: 375.5, height: 700.25 })
    }
    const previewClasses = new Set()
    const preview = {
      classList: { add: name => previewClasses.add(name), remove: name => previewClasses.delete(name) },
      getBoundingClientRect: () => ({ left: 16.25, top: 180.75, width: 160.5, height: 90.28125 })
    }
    const transition = ctx.createOrganizerSwipeAnimation(page, preview, { animate })
    transition.update(0.4)
    assert.ok(animations.every(animation => animation.currentTime === 400))
    if (!reduced) {
      assert.ok(previewClasses.has('organizerSwipePreview'), 'the moving page replaces its cached image')
      assert.equal(animations[0].frames[1].opacity, 1, 'a page that fills its card remains visible')
      assert.ok(animations[0].frames[1].transform.includes('translate(16.25px, 100.25px)'))
      assert.ok(animations[0].frames[1].transform.includes(`scale(${160.5 / 375.5})`))
      assert.ok(animations[0].frames[1].clipPath.endsWith(`round ${6 / (160.5 / 375.5)}px ${6 / (160.5 / 375.5)}px 0 0)`))
    }
    await transition.finish(true)
    assert.ok(animations.slice(0, reduced ? 1 : 2).every(animation => animation.currentTime === 1000))
    transition.dispose()
    assert.equal(classes.size, 0)
    assert.equal(previewClasses.size, 0, 'the cached image returns after settling or cancellation')
    assert.ok(animations.every(animation => animation.cancelled))
    transition.update(0.1)
    assert.equal(animations[0].currentTime, 1000, 'cleanup cannot be undone by an asynchronous continuation')
  })
}
