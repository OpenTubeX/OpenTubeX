import assert from 'node:assert/strict'
import test from 'node:test'
import { createListWindow } from '../../src/renderer/helpers/windowedList.js'

function fixture() {
  let intersect, resize, nextFrame
  let mounted = true
  let protectedState = false
  let reads = 0
  const element = { getBoundingClientRect() { reads++; return { height: 123.5 } } }
  const windowing = createListWindow({
    IntersectionObserver: class { constructor(fn) { intersect = fn } observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { constructor(fn) { resize = fn } observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame(fn) { nextFrame = fn; return 1 },
    cancelAnimationFrame() { nextFrame = null },
  })
  windowing.observe(element, {
    mount() { mounted = true }, unmount() { mounted = false },
    isMounted: () => mounted, isProtected: () => protectedState,
  })
  return {
    windowing, mounted: () => mounted, reads: () => reads,
    protect() { protectedState = true },
    far() { intersect([{ target: element, isIntersecting: false }]) },
    resize(width, height) { resize([{ target: element, contentRect: { width, height } }]) },
    frame() { const fn = nextFrame; nextFrame = null; fn?.() },
  }
}

test('eviction before the first resize measurement preserves height for a later width change', () => {
  const f = fixture()
  f.far(); f.frame()
  assert.equal(f.mounted(), false)
  f.resize(300, 0)
  f.resize(200, 0)
  f.frame()
  assert.equal(f.mounted(), true)
  f.windowing.disconnect()
})

test('remeasures distant cards in bounded batches after their width changes', () => {
  let intersect, resize
  let nextFrameId = 0
  const frames = new Map()
  const mounted = new Set()
  let mounts = 0
  const windowing = createListWindow({
    IntersectionObserver: class { constructor(fn) { intersect = fn } observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { constructor(fn) { resize = fn } observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame(fn) { frames.set(++nextFrameId, fn); return nextFrameId },
    cancelAnimationFrame(id) { frames.delete(id) },
  })
  const elements = Array.from({ length: 100 }, () => ({ getBoundingClientRect: () => ({ height: 123.5 }) }))
  for (const element of elements) {
    mounted.add(element)
    windowing.observe(element, {
      mount() { mounts++; mounted.add(element) },
      unmount() { mounted.delete(element) },
      isMounted: () => mounted.has(element),
      isProtected: () => false,
    })
  }
  const runFrame = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback()
  }
  const entries = width => elements.map(target => ({ target, contentRect: { width, height: 123.5 } }))
  resize(entries(300))
  intersect(elements.map(target => ({ target, isIntersecting: false })))
  runFrame()
  assert.equal(mounted.size, 0)

  resize(entries(200))
  assert.equal(mounts, 0, 'resizing must not remount the entire feed synchronously')
  const nearbyElement = elements.at(-1)
  intersect([{ target: nearbyElement, isIntersecting: true }])
  assert.equal(mounts, 1, 'a card entering view should mount immediately')
  for (let index = 0; index < 60 && frames.size > 0; index++) {
    const before = mounts
    runFrame()
    assert.ok(mounts - before <= 2, 'each frame should remeasure only a few distant cards')
  }
  assert.equal(mounts, elements.length)
  assert.deepEqual([...mounted], [nearbyElement])
  windowing.disconnect()
})

test('disconnect cancels protected retries and future frame work', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  f.protect(); f.far(); f.frame()
  f.windowing.disconnect()
  const reads = f.reads()
  t.mock.timers.tick(30_000)
  f.frame()
  assert.equal(f.reads(), reads)
})

test('protected offscreen cards do not repeatedly read layout', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  f.protect(); f.far(); f.frame()
  const reads = f.reads()
  for (let n = 0; n < 10; n++) { t.mock.timers.tick(1000); f.frame() }
  assert.equal(f.reads(), reads)
  f.windowing.disconnect()
})
