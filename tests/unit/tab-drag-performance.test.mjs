import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { nextTick, ref, watch } from 'vue'
import * as reorder from '../../src/renderer/components/TabBar/tabReorder.js'

const component = readFileSync(new URL('../../src/renderer/components/TabBar/TabBar.vue', import.meta.url), 'utf8')
const source = component.slice(
  component.indexOf('// ===== Drag and drop state ====='),
  component.indexOf('// ===== Vertical tab bar resizing =====')
)
const scrollHandler = component.match(/function handleScroll\(\) \{[\s\S]*?\n\}/)[0]

function createDragHarness({ vertical = false, count = 100 } = {}) {
  const frames = new Map()
  let frameId = 0
  const timers = new Map()
  let timerId = 0
  const calls = { orders: 0, offsets: 0, updates: 0 }
  const tabs = ref(Array.from({ length: count }, (_, index) => ({ id: `tab-${index}` })))

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
    getBoundingClientRect: () => ({ left: 0, top: 0 })
  }
  const api = vm.runInNewContext(`${source}\n${scrollHandler}\n({
    handleTabContainerPointerDown, handleDragPointerMove, handleDragPointerUp,
    handleDragPointerCancel, handleScroll, cleanupDragListeners, tabOffsets,
    getSession: () => dragSession, getPendingOrder: () => pendingSettleReorder
  })`, {
    ...reorder,
    buildShiftedTabIds(...args) { calls.orders++; return reorder.buildShiftedTabIds(...args) },
    computeTabOffsets(...args) { calls.offsets++; return reorder.computeTabOffsets(...args) },
    ref, watch, nextTick,
    Element: TabElement, HTMLElement: TabElement,
    vertical: ref(vertical), tabs, stripItems: tabs,
    selectedTabIds: ref(new Set()), closeTooltipsSignal: ref(0),
    dropZoneRef: { value: container },
    buildStripItems: items => items,
    clearTabSelection() {}, setTabSelection() {}, updateScrollbar() {},
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
  api.handleTabContainerPointerDown(event(50.25))
  calls.orders = calls.offsets = calls.updates = 0

  return {
    api, calls, frames, container,
    move: position => api.handleDragPointerMove(event(position)),
    flushFrame() {
      const pending = Array.from(frames.values())
      frames.clear()
      for (const callback of pending) callback()
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
