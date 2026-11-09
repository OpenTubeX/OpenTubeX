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
    mount() { mounted = true },
    unmount() { mounted = false },
    isMounted: () => mounted,
    isProtected: () => protectedState,
  })
  return {
    windowing,
    mounted: () => mounted,
    reads: () => reads,
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

test('remeasures restyled shells in bounded batches and leaves hidden rows waiting', () => {
  let intersect, resize
  const frames = []
  const windowing = createListWindow({
    IntersectionObserver: class { constructor(fn) { intersect = fn } observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { constructor(fn) { resize = fn } observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length },
    cancelAnimationFrame() {},
  })
  const runFrame = () => { for (const callback of frames.splice(0)) callback() }

  let rowHeight = 100
  let mounts = 0
  const mounted = new Map()
  const shellHeights = new Map()
  const handles = []
  // A long playlist, such as the watch-page panel with hundreds of rows.
  const elements = Array.from({ length: 300 }, () => {
    const element = { getBoundingClientRect: () => ({ height: rowHeight }) }
    mounted.set(element, true)
    handles.push(windowing.observe(element, {
      mount() { mounts++; mounted.set(element, true) },
      unmount(height) { mounted.set(element, false); shellHeights.set(element, height) },
      isMounted: () => mounted.get(element),
      isProtected: () => false,
    }))
    return element
  })
  resize(elements.map(target => ({ target, contentRect: { width: 300, height: rowHeight } })))
  intersect(elements.map(target => ({ target, isIntersecting: false })))
  runFrame()
  assert.equal([...mounted.values()].filter(Boolean).length, 0)

  // A setting such as two-line titles restyles every row without a resize.
  // The last row is hidden, as in a collapsed playlist.
  rowHeight = 60
  const hidden = elements.at(-1)
  resize([{ target: hidden, contentRect: { width: 0, height: 0 } }])
  for (const handle of handles) handle.remeasure()
  assert.equal(mounts, 0, 'restyling must not remount the whole list synchronously')
  let frameCount = 0
  while (frames.length > 0 && frameCount < 1000) {
    const before = mounts
    runFrame()
    frameCount++
    assert.ok(mounts - before <= 2, 'each frame should remeasure only a few distant rows')
  }
  assert.equal(mounts, elements.length - 1, 'the hidden row waits until it can be measured')
  assert.equal(mounted.get(hidden), false)
  assert.ok(elements.slice(0, -1).every(element => shellHeights.get(element) === 60 && !mounted.get(element)))

  resize([{ target: hidden, contentRect: { width: 300, height: 60 } }])
  while (frames.length > 0) runFrame()
  assert.equal(shellHeights.get(hidden), 60)
  windowing.disconnect()
})

test('remeasures every cell of a grid row in the same frame', () => {
  let intersect, resize
  const frames = []
  const windowing = createListWindow({
    IntersectionObserver: class { constructor(fn) { intersect = fn } observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { constructor(fn) { resize = fn } observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length },
    cancelAnimationFrame() {},
  })
  const runFrame = () => { for (const callback of frames.splice(0)) callback() }

  const columns = 4
  let cardHeight = 100
  const mounted = new Map()
  const shellHeights = new Map()
  const handles = []
  const elements = Array.from({ length: 40 }, (_, index) => {
    const row = Math.floor(index / columns)
    const rowElements = () => elements.slice(row * columns, (row + 1) * columns)
    // A grid cell is as tall as the tallest cell or shell in its row.
    const element = {
      offsetTop: row * 1000,
      getBoundingClientRect: () => ({
        height: Math.max(...rowElements().map(cell => mounted.get(cell) ? cardHeight : shellHeights.get(cell) ?? cardHeight))
      })
    }
    mounted.set(element, true)
    handles.push(windowing.observe(element, {
      mount() { mounted.set(element, true) },
      unmount(height) { mounted.set(element, false); shellHeights.set(element, height) },
      isMounted: () => mounted.get(element),
      isProtected: () => false,
    }))
    return element
  })
  resize(elements.map(target => ({ target, contentRect: { width: 300, height: cardHeight } })))
  intersect(elements.map(target => ({ target, isIntersecting: false })))
  runFrame()

  // A smaller font size shrinks every card without resizing the grid.
  cardHeight = 70
  for (const handle of handles) handle.remeasure()
  for (let frameCount = 0; frames.length > 0 && frameCount < 1000; frameCount++) runFrame()
  assert.ok(elements.every(element => shellHeights.get(element) === 70 && !mounted.get(element)))
  windowing.disconnect()
})

test('keeps remeasuring shells when the list hides during a remeasure', () => {
  let intersect, resize
  const frames = []
  const windowing = createListWindow({
    IntersectionObserver: class { constructor(fn) { intersect = fn } observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { constructor(fn) { resize = fn } observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length },
    cancelAnimationFrame() {},
  })
  const runFrame = () => { for (const callback of frames.splice(0)) callback() }
  const runFrames = () => { while (frames.length) runFrame() }

  let rowHeight = 100
  let hidden = false
  const mounted = new Map()
  const shellHeights = new Map()
  const elements = Array.from({ length: 6 }, () => {
    const element = { getBoundingClientRect: () => ({ height: hidden ? 0 : rowHeight }) }
    mounted.set(element, true)
    windowing.observe(element, {
      mount() { mounted.set(element, true) },
      unmount(height) { mounted.set(element, false); shellHeights.set(element, height) },
      isMounted: () => mounted.get(element),
      isProtected: () => false,
    })
    return element
  })
  // Hidden rows, such as a playlist behind v-show, report an empty box.
  const resizeAll = width => resize(elements.map(target => ({
    target, contentRect: hidden ? { width: 0, height: 0 } : { width, height: rowHeight },
  })))
  resizeAll(300)
  intersect(elements.map(target => ({ target, isIntersecting: false })))
  runFrames()
  assert.deepEqual([...shellHeights.values()], [100, 100, 100, 100, 100, 100])

  // A restyle queues every shell. The first batch remounts two of them, but
  // the list hides before they are laid out and before the other batches run.
  rowHeight = 60
  resizeAll(200)
  runFrame()
  hidden = true
  resizeAll(200)
  runFrames()

  // Showing the list at the same width must still rebuild the stale shells.
  hidden = false
  resizeAll(200)
  runFrames()
  assert.deepEqual([...shellHeights.values()], [60, 60, 60, 60, 60, 60])
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

function fakeViewport() {
  const listeners = new Set()
  return {
    innerWidth: 400,
    addEventListener(_type, listener) { listeners.add(listener) },
    removeEventListener(_type, listener) { listeners.delete(listener) },
    resize() { for (const listener of listeners) listener() },
    listeners,
  }
}

test('extends the overscan into nested scrollers only for nested windows', () => {
  const options = []
  const create = nested => createListWindow({
    IntersectionObserver: class { constructor(_fn, opts) { options.push(opts) } observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  }, { nested, viewport: fakeViewport() })
  create(false).disconnect()
  create(true).disconnect()
  assert.equal(options[0].scrollMargin, undefined)
  assert.equal(options[1].scrollMargin, options[1].rootMargin)
})

test('remeasures nested shells only when a height-only resize restyles mounted rows', () => {
  let intersect, resize
  const frames = []
  const viewport = fakeViewport()
  const windowing = createListWindow({
    IntersectionObserver: class { constructor(fn) { intersect = fn } observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { constructor(fn) { resize = fn } observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length },
    cancelAnimationFrame() {},
  }, { nested: true, viewport })
  const runFrames = () => { while (frames.length) frames.shift()() }

  let rowHeight = 100
  const mounted = new Map()
  const refreshes = []
  const add = name => {
    const element = { getBoundingClientRect: () => ({ height: rowHeight }) }
    mounted.set(element, true)
    windowing.observe(element, {
      mount() { if (!mounted.get(element)) refreshes.push(name); mounted.set(element, true) },
      unmount() { mounted.set(element, false) },
      isMounted: () => mounted.get(element),
      isProtected: () => false,
    })
    resize([{ target: element, contentRect: { width: 300, height: rowHeight } }])
    return element
  }
  const near = add('near')
  const shell = add('shell')
  intersect([{ target: near, isIntersecting: true }, { target: shell, isIntersecting: false }])
  runFrames()
  assert.equal(mounted.get(shell), false)

  // The keyboard shrinks the viewport, but rows keep their height.
  viewport.resize()
  runFrames()
  assert.deepEqual(refreshes, [])

  // A height-only breakpoint shrinks every row; the stale shell is rebuilt.
  rowHeight = 60
  viewport.resize()
  runFrames()
  assert.deepEqual(refreshes, ['shell'])

  windowing.disconnect()
  assert.equal(viewport.listeners.size, 0)
})
