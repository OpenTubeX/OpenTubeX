import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { nextTick, reactive, ref, watchEffect } from 'vue'
import { getTabGridReorder } from '../../src/renderer/components/TabBar/tabGridReorder.js'
import { shouldCloseSwipedTab } from '../../src/renderer/helpers/capacitorTabSwipe.js'

const component = readFileSync(new URL('../../src/renderer/components/TabBar/CapacitorPhoneTabSwitcher.vue', import.meta.url), 'utf8')
const declarations = component.slice(component.indexOf('const TAB_HOLD_DELAY'), component.indexOf('const {\n  selecting,'))
const handlers = component.slice(component.indexOf('function tabCardStyle'), component.indexOf('function focusActiveTab'))
const rowClasses = component.match(/class="capacitorPhoneTabRow"\s+:class="(\{[^]*?\})"/)[1]

function fixture({ reducedMotion = false, close = null, pinned = false } = {}) {
  let now = 0
  let nextId = 0
  const timers = new Map()
  const frames = new Map()
  const closed = []
  let layouts = 0
  const tabs = ref(Array.from({ length: 100 }, (_, i) => ({ id: `tab-${i}`, isPinned: pinned && i === 0 })))
  const row = (_, index) => ({
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value) },
    removeAttribute(name) { this.attributes.delete(name) },
    style: { setProperty(name, value) { this[name] = value }, removeProperty(name) { delete this[name] } },
    getBoundingClientRect: () => ({ left: (index % 2) * 192.5, top: Math.floor(index / 2) * 240.5, width: 180.5, height: 228.5 }),
    setPointerCapture() {}, querySelector() { return { dataset: { tabId: `tab-${index}` } } }
  })
  const rows = tabs.value.map(row)
  const api = vm.runInNewContext(`${declarations}\n${handlers}\n({
    startTabGesture, moveTabGesture, finishTabGesture, cancelTabGesture, resetTabSwipe,
    renderRows: () => tabs.value.map(tab => [(${rowClasses}), tabCardStyle(tab.id)])
  })`, {
    reactive, ref, nextTick, tabs, shouldCloseSwipedTab, activeTabId: ref('tab-0'),
    selecting: ref(false), actionTab: ref(null),
    performance: { now: () => now },
    getTabGridReorder(...args) { layouts++; return getTabGridReorder(...args) },
    getComputedStyle: () => ({ paddingBottom: '88px' }),
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame(callback) { frames.set(++nextId, callback); return nextId },
    cancelAnimationFrame(id) { frames.delete(id) },
    window: {
      setTimeout(callback, delay) { timers.set(++nextId, { callback, at: now + delay }); return nextId },
      clearTimeout(id) { timers.delete(id) }
    },
    closeTab: async id => { closed.push(id); if (close) await close(id) },
    openTabsContentRef: ref({ querySelectorAll: () => rows, getBoundingClientRect: () => ({ bottom: 12025 }) }),
    openTabsScrollRef: ref({ scrollTop: 0, clientHeight: 600, getBoundingClientRect: () => ({ top: 0, bottom: 600 }) }),
    openTabActions() {}, closeTabActions() {}, lightHaptic() {}, clampOverlayScrollTop() {},
  })
  function event(x, index = 0) {
    return { button: 0, pointerId: index + 1, pointerType: 'touch', clientX: x, clientY: 100,
      timeStamp: now, currentTarget: rows[index], target: { closest: () => null }, preventDefault() {} }
  }
  return {
    api, closed, frames, rows, get layouts() { return layouts },
    timers,
    start: (index = 0) => api.startTabGesture(event(0, index), `tab-${index}`),
    move: (x, index = 0) => api.moveTabGesture(event(x, index)),
    finish: (x, index = 0) => api.finishTabGesture(event(x, index)),
    async tick(ms) {
      now += ms
      const pending = [...timers].filter(([, timer]) => timer.at <= now)
      for (const [id, timer] of pending) { timers.delete(id); await timer.callback() }
    },
    frame() { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(now) }
  }
}

test('closing swipe does not render every tab card for every movement', async () => {
  const f = fixture()
  let renders = 0
  const stop = watchEffect(() => { f.api.renderRows(); renders++ })
  try {
    f.start()
    await nextTick()
    const before = renders
    for (let i = 0; i < 20; i++) {
      f.move(10 + i * 2)
      await nextTick()
      f.frame()
    }
    assert.ok(renders - before <= 1, `Gesture recognition may render once; movements must not render the 100-card list (got ${renders - before})`)
  } finally { stop() }
})

test('a second gesture cannot cancel a tab close that is animating', async () => {
  const f = fixture()
  f.start()
  f.move(100)
  f.finish(100)
  await f.tick(50)
  f.start(1)
  f.move(-100, 1)
  f.finish(-100, 1)
  await f.tick(200)
  assert.deepEqual(f.closed, ['tab-0', 'tab-1'])
})

test('long-press reorder coalesces pointer bursts into one layout per frame', async () => {
  const f = fixture()
  f.start()
  await f.tick(400)
  for (let i = 0; i < 50; i++) f.move(10 + i)
  assert.equal(f.layouts, 0, 'Pointer handlers only record the newest position')
  assert.equal(f.frames.size, 1)
  f.frame()
  assert.equal(f.layouts, 1)
  f.api.cancelTabGesture()
  f.frame()
  assert.equal(f.layouts, 1, 'Cancelled frames do not update the grid')
})

test('swipe bursts paint only the latest fractional position in one frame', () => {
  const f = fixture()
  f.start()
  for (let i = 0; i < 50; i++) f.move(10.25 + i)
  assert.equal(f.frames.size, 1)
  assert.equal(f.rows[0].style['--tab-swipe-transform'], undefined)
  f.frame()
  assert.equal(f.rows[0].style['--tab-swipe-transform'], 'translate3d(59.25px, 0, 0)')
  assert.equal(f.rows[1].style['--tab-swipe-transform'], undefined)
})

for (const cancel of ['cancelTabGesture', 'resetTabSwipe']) {
  test(`${cancel} discards queued swipe work and restores the card`, async () => {
    const f = fixture()
    f.start()
    f.move(40)
    f.api[cancel]()
    f.frame()
    await f.tick(170)
    assert.equal(f.frames.size, 0)
    assert.equal(f.rows[0].style['--tab-swipe-transform'], undefined)
    assert.equal(f.rows[0].attributes.size, 0)
    assert.deepEqual(f.closed, [])
  })
}

for (const reducedMotion of [false, true]) {
  test(`release uses the newest pointer sample before the frame (reduced motion: ${reducedMotion})`, async () => {
    const f = fixture({ reducedMotion })
    f.start()
    f.move(10)
    f.finish(100)
    assert.equal(f.frames.size, 0)
    await f.tick(reducedMotion ? 0 : 160)
    assert.deepEqual(f.closed, ['tab-0'])
  })
}

test('completion of an older close does not reset the next swipe', async () => {
  let finishClose
  const f = fixture({ close: () => new Promise(resolve => { finishClose = resolve }) })
  f.start()
  f.move(100)
  f.finish(100)
  const closing = f.tick(160)
  f.start(1)
  f.move(-40, 1)
  f.frame()
  finishClose()
  await closing
  f.move(-60.5, 1)
  f.frame()
  assert.equal(f.rows[1].style['--tab-swipe-transform'], 'translate3d(-60.5px, 0, 0)')
  assert.equal(f.rows[1].attributes.has('data-tab-swiping'), true)
})

test('a pinned card cannot be swiped closed', async () => {
  const f = fixture({ pinned: true })
  f.start()
  f.move(100)
  f.finish(100)
  f.frame()
  await f.tick(200)
  assert.deepEqual(f.closed, [])
  assert.equal(f.rows[0].style['--tab-swipe-transform'], undefined)
})

test('release before the reorder frame still commits the newest drop slot', async () => {
  const f = fixture()
  f.start()
  await f.tick(400)
  f.move(192.5)
  f.finish(192.5)
  assert.equal(f.layouts, 1, 'Release flushes the pending layout synchronously')
  assert.equal(f.frames.size, 0)
})
