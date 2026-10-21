import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { nextTick, ref, watch } from 'vue'
import { computeReorderOffsets } from '../../src/renderer/helpers/reorderOffsets.js'
import * as reorder from '../../src/renderer/components/TabBar/tabReorder.js'

const component = readFileSync(new URL('../../src/renderer/components/TabBar/TabBar.vue', import.meta.url), 'utf8')
const source = component.slice(
  component.indexOf('// ===== Drag and drop state ====='),
  component.indexOf('// ===== Vertical tab bar resizing =====')
)
const scrollHandler = component.match(/function handleScroll\(\) \{[\s\S]*?\n\}/)[0]

function createDragHarness({ vertical = false, count = 100, pinnedCount = 0, sourceIndex = 0 } = {}) {
  const frames = new Map()
  let frameId = 0
  const timers = new Map()
  let timerId = 0
  const calls = { orders: 0, offsets: 0, updates: 0 }
  let now = 0
  const tabs = ref(Array.from({ length: count }, (_, index) => ({ id: `tab-${index}`, isPinned: index < pinnedCount })))

  class TabElement {
    constructor(index) { this.index = index; this.dataset = { reorderId: `tab-${index}` } }
    closest(selector) { return selector.includes('tabBarReorderItem') ? this : null }
    getBoundingClientRect() {
      return { left: vertical ? 0 : this.index * 102.5, top: vertical ? this.index * 102.5 : 0, width: 100.5, height: 100.5 }
    }
  }
  const elements = tabs.value.map((_, index) => new TabElement(index))
  const container = {
    scrollLeft: 0, scrollTop: 0,
    querySelectorAll: () => elements,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 1000 })
  }
  const api = vm.runInNewContext(`${source}\n${scrollHandler}\n({
    handleTabContainerPointerDown, handleDragPointerMove, handleDragPointerUp,
    handleDragPointerCancel, handleScroll, cleanupDragListeners, tabOffsets,
    getSession: () => dragSession, getPendingOrder: () => pendingSettleReorder
  })`, {
    ...reorder,
    buildShiftedTabIds(...args) { calls.orders++; return reorder.buildShiftedTabIds(...args) },
    computeReorderOffsets(...args) { calls.offsets++; return computeReorderOffsets(...args) },
    ref, watch, nextTick,
    Element: TabElement, HTMLElement: TabElement,
    vertical: ref(vertical), tabs, stripItems: tabs,
    selectedTabIds: ref(new Set()), closeTooltipsSignal: ref(0),
    dropZoneRef: { value: container },
    buildStripItems: items => items,
    clearTabSelection() {}, setTabSelection() {}, cancelScrollAnimation() {},
    performance: { now: () => now },
    isElectron: false,
    document: { body: { classList: { add() {}, remove() {} } } },
    window: {
      addEventListener() {}, removeEventListener() {},
      setTimeout(callback) { timers.set(++timerId, callback); return timerId },
      clearTimeout(id) { timers.delete(id) }
    },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId },
    clearTimeout(id) { timers.delete(id) },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame(id) { frames.delete(id) }
  })
  watch(api.tabOffsets, () => calls.updates++, { flush: 'sync' })
  const event = (position, target = elements[0]) => ({
    button: 0, target,
    clientX: vertical ? 50 : position, clientY: vertical ? position : 50,
    preventDefault() {}
  })
  api.handleTabContainerPointerDown(event(50.25, elements[sourceIndex]))
  calls.orders = calls.offsets = calls.updates = 0

  return {
    api, calls, frames, container,
    move: position => api.handleDragPointerMove(event(position)),
    flushFrame(elapsed = 16) {
      now += elapsed
      const pending = Array.from(frames.values())
      frames.clear()
      for (const callback of pending) callback(now)
    }
  }
}

test('coalesces pointer and scroll bursts into one drag update per frame', () => {
  const harness = createDragHarness()
  for (let index = 0; index < 50; index++) {
    harness.move(60 + index)
    harness.container.scrollLeft = index / 2
    harness.api.handleScroll()
  }
  assert.equal(harness.calls.updates, 0, 'input handlers defer visual work until the frame')
  assert.equal(harness.frames.size, 1)
  harness.flushFrame()
  assert.equal(harness.calls.updates, 1)
  assert.equal(harness.api.tabOffsets.value['tab-0'], 83.25, 'uses the latest pointer and scroll positions')
  harness.move(109)
  harness.api.handleScroll()
  harness.flushFrame()
  assert.equal(harness.calls.updates, 1, 'unchanged input does not trigger another visual update')
})

test('reuses tab order and neighbor offsets until the dragged tab crosses a slot', () => {
  const harness = createDragHarness()
  harness.move(160)
  harness.flushFrame()
  const baseline = { ...harness.calls }
  for (let index = 0; index < 20; index++) {
    harness.move(161 + index)
    harness.flushFrame()
  }
  assert.equal(harness.calls.orders, baseline.orders, 'does not rebuild an unchanged order')
  assert.equal(harness.calls.offsets, baseline.offsets, 'does not recalculate unchanged neighbor offsets')
  harness.move(260)
  harness.flushFrame()
  assert.equal(harness.calls.orders, baseline.orders + 1)
  assert.equal(harness.calls.offsets, baseline.offsets + 1)
})

test('releasing before the frame commits the latest drag position in both layouts', () => {
  for (const vertical of [false, true]) {
    const harness = createDragHarness({ vertical })
    harness.move(160)
    harness.move(365)
    harness.api.handleDragPointerUp()
    assert.equal(harness.api.getPendingOrder().indexShift, 3)
    assert.equal(harness.api.getSession(), null)
    assert.equal(harness.frames.size, 0, 'release cancels queued drag work')
    assert.equal(harness.api.tabOffsets.value['tab-0'], 307.5)
  }
})

test('cancel and listener cleanup discard queued drag work', () => {
  for (const cleanup of ['handleDragPointerCancel', 'cleanupDragListeners']) {
    const harness = createDragHarness()
    harness.move(160)
    harness.api[cleanup]()
    const updates = harness.calls.updates
    harness.flushFrame()
    assert.equal(harness.frames.size, 0)
    assert.equal(harness.calls.updates, updates)
  }
})

test('scrolls toward the end the dragged pointer is held near in both layouts', () => {
  for (const vertical of [false, true]) {
    const harness = createDragHarness({ vertical })
    const axis = vertical ? 'scrollTop' : 'scrollLeft'
    const assertScroll = (expected, message) => {
      assert.ok(Math.abs(harness.container[axis] - expected) < 1e-9, `${message}: ${harness.container[axis]}`)
    }

    harness.move(500)
    harness.flushFrame()
    assertScroll(0, 'the middle of the list does not scroll')
    assert.equal(harness.frames.size, 0)

    harness.move(976)
    harness.flushFrame(20)
    assertScroll(0.5 * 0.6 * 20, 'scrolls slower halfway into the edge')
    harness.move(1100)
    harness.flushFrame(50)
    assertScroll(6 + 0.6 * 50, 'scrolls at full speed past the edge')
    harness.flushFrame(1000)
    assertScroll(36 + 0.6 * 100, 'limits the jump after a stalled frame')

    harness.move(500)
    harness.flushFrame()
    assert.equal(harness.frames.size, 0, 'stops once the pointer leaves the edge')
    const position = harness.container[axis]
    harness.move(-20)
    harness.flushFrame(10)
    assertScroll(position - 0.6 * 10, 'scrolls back toward the start')

    harness.api.handleDragPointerUp()
    assert.equal(harness.frames.size, 0, 'release stops scrolling')
  }
})

test('stops autoscrolling once the dragged tab group is visible at that end', () => {
  for (const vertical of [false, true]) {
    const harness = createDragHarness({ vertical, pinnedCount: 3 })
    const axis = vertical ? 'scrollTop' : 'scrollLeft'

    harness.move(1100)
    harness.flushFrame()
    assert.equal(harness.container[axis], 0, 'the pinned group already ends inside the list')
    assert.equal(harness.frames.size, 0)

    harness.container[axis] = 200
    harness.move(-20)
    harness.flushFrame(10)
    assert.ok(Math.abs(harness.container[axis] - (200 - 0.6 * 10)) < 1e-9, 'still scrolls back to hidden pinned tabs')
    harness.container[axis] = 0
    harness.flushFrame()
    assert.equal(harness.container[axis], 0)
    assert.equal(harness.frames.size, 0, 'stops at the start of the pinned group')
  }
})

test('scrolls past pinned tabs to the start while the grabbed unpinned tab stays visible', () => {
  for (const vertical of [false, true]) {
    // With 12 pinned tabs, the grabbed tab held after them leaves the 1000 px list below this offset.
    for (const [pinnedCount, minimumScroll] of [[2, 0], [12, 12 * 102.5 + 100.5 - 1000]]) {
      const harness = createDragHarness({ vertical, pinnedCount, sourceIndex: 50 })
      const axis = vertical ? 'scrollTop' : 'scrollLeft'

      harness.container[axis] = minimumScroll + 100
      harness.move(-20)
      harness.flushFrame(10)
      assert.ok(
        Math.abs(harness.container[axis] - (minimumScroll + 100 - 0.6 * 10)) < 1e-9,
        `scrolls past the start of the unpinned group: ${harness.container[axis]}`
      )
      harness.container[axis] = minimumScroll
      harness.flushFrame()
      assert.equal(harness.container[axis], minimumScroll)
      assert.equal(harness.frames.size, 0, `stops at ${minimumScroll} with ${pinnedCount} pinned tabs`)
    }
  }
})
