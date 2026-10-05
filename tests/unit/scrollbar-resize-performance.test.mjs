import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/helpers/overlayScrollbars.js', import.meta.url), 'utf8')
const boundaryTolerance = source.match(/^const SCROLL_BOUNDARY_TOLERANCE = .+$/m)[0]
const resizeFunction = source.slice(source.indexOf('function reconcileScrollbarOnResize('), source.indexOf('/**\n * OverlayScrollbars applies'))

function setup() {
  let callback
  let frame
  let updates = 0
  const element = {
    clientHeight: 100, clientWidth: 100, scrollHeight: 300, scrollTop: 0,
    getBoundingClientRect() { return { width: this.clientWidth } }
  }
  const instance = {
    update: () => { updates++ },
    state: () => ({ overflowAmount: { y: Math.max(0, element.scrollHeight - element.clientHeight) } }),
    on: () => {}
  }
  const context = vm.createContext({
    ResizeObserver: class {
      constructor(handler) { callback = handler }
      observe() {}
    },
    requestAnimationFrame: handler => { frame = handler; return 1 },
    cancelAnimationFrame: () => {},
    suspendScrollbarPosition: new WeakMap()
  })
  vm.runInContext(`${boundaryTolerance}\n${resizeFunction}\nthis.reconcile = reconcileScrollbarOnResize`, context)
  context.reconcile(element, instance)
  return { element, updates: () => updates, resize: () => { callback(); frame() } }
}

test('nested resize reconciliation leaves ordinary measurements to the library observer', () => {
  const fixture = setup()
  fixture.resize() // Initial observer delivery.
  fixture.element.clientWidth = 120
  fixture.resize() // Width-only reflow.
  fixture.element.clientHeight = 120 // Growth away from the end.
  fixture.resize()
  fixture.element.clientHeight = 80 // Shrinkage cannot retain an obsolete end.
  fixture.resize()
  assert.equal(fixture.updates(), 0)
})

test('nested resize reconciliation still discards obsolete offsets during growth', () => {
  const fixture = setup()
  fixture.element.scrollTop = 200
  fixture.element.clientHeight = 400
  fixture.resize()
  assert.equal(fixture.element.scrollTop, 0)
  assert.ok(fixture.updates() > 0)
})

test('nested resize reconciliation remeasures a retained end after fractional width growth', () => {
  const fixture = setup()
  fixture.element.scrollTop = 200
  fixture.element.clientWidth = 100.25
  fixture.resize()
  assert.ok(fixture.updates() > 0, 'wider wrapped content needs an origin measurement even at the same height')
})

test('nested resize reconciliation clamps an invalid offset without viewport growth', () => {
  const fixture = setup()
  fixture.element.scrollTop = 200
  fixture.element.scrollHeight = 150
  fixture.resize()
  assert.equal(fixture.element.scrollTop, 50)
  assert.ok(fixture.updates() > 0)
})

const clampFunction = source.slice(source.indexOf('export function clampOverlayScrollTop('), source.indexOf('/**\n * Recalculates a nested horizontal scroll'))
const measurementFunctions = source.slice(source.indexOf('function getMaximumOverlayScrollTop('), source.indexOf('/**\n * `v-overlay-scrollbars`'))

function setupClamp({ scrollTop = 211, overflow = 426 } = {}) {
  const writes = []
  let currentOffset = scrollTop
  let currentOverflow = overflow
  const element = {
    clientHeight: 598, offsetTop: 0, offsetParent: null,
    get scrollTop() { return currentOffset },
    set scrollTop(value) { writes.push(value); currentOffset = value }
  }
  const content = { offsetTop: 20, offsetHeight: 773, offsetParent: element }
  const instance = {
    elements: () => ({ scrollOffsetElement: element }),
    update: () => { if (element.scrollTop === 0) currentOverflow = 215 },
    state: () => ({ overflowAmount: { y: currentOverflow } })
  }
  const context = vm.createContext({
    document: { body: {} },
    OverlayScrollbars: () => instance,
    getComputedStyle: target => ({ marginBlockEnd: '0', paddingBottom: target === element ? '20' : '0' }),
    suspendScrollbarPosition: new WeakMap()
  })
  vm.runInContext(`${boundaryTolerance}\n${measurementFunctions}\n${clampFunction.replace('export ', '')}\nthis.clamp = clampOverlayScrollTop`, context)
  return { element, writes, overflow: () => currentOverflow, clamp: () => context.clamp(element, content) }
}

test('clamping refreshes retained overflow while preserving a valid scroll offset', () => {
  const fixture = setupClamp()
  fixture.clamp()
  assert.deepEqual(fixture.writes, [0, 211])
  assert.equal(fixture.overflow(), 215)
  assert.equal(fixture.element.scrollTop, 211)
})

test('clamping leaves an accurate scroll range and valid offset untouched', () => {
  const fixture = setupClamp({ overflow: 215 })
  fixture.clamp()
  assert.deepEqual(fixture.writes, [])
  assert.equal(fixture.element.scrollTop, 211)
})

test('clamping tolerates fractional range differences without resetting the origin', () => {
  const fixture = setupClamp({ scrollTop: 215.4, overflow: 215.8 })
  fixture.clamp()
  assert.deepEqual(fixture.writes, [])
  assert.equal(fixture.element.scrollTop, 215.4)
})

const optionsFunctions = source.slice(source.indexOf('function scrollbarOptions('), source.indexOf('/**\n * @param {HTMLElement | object}'))

test('page scrollbar ignores clipped tab-bar mutations while nested scrollbars still observe them', () => {
  class Element {
    constructor(inTabBar = false) { this.inTabBar = inTabBar }
    closest(selector) { return selector === '.tabBar' && this.inTabBar ? this : null }
  }
  const body = new Element()
  const context = vm.createContext({
    Element,
    document: { body, documentElement: { dir: 'ltr' } },
    process: { env: { IS_CAPACITOR: false } }
  })
  const options = vm.runInContext(`${optionsFunctions}; scrollbarOptions(document.body)`, context)
  const ignore = options.update.ignoreMutation
  const tab = new Element(true)
  assert.equal(ignore({ target: tab }), true)
  assert.equal(ignore({ target: { parentElement: tab } }), true, 'tab title text does not change page overflow')
  assert.equal(ignore({ target: new Element() }), false, 'page content still triggers measurements')
  assert.equal(ignore({ target: { parentElement: new Element() } }), false)
  assert.equal(ignore({ target: { parentElement: null } }), false)
  assert.deepEqual(Array.from(options.update.debounce.resize), [0, 33])
  context.nested = { elements: { viewport: tab } }
  assert.equal(vm.runInContext('scrollbarOptions(nested).update', context), undefined, 'nested tab-bar scrolling keeps its own observers')
  context.document.documentElement.dir = 'rtl'
  assert.equal(options.update.flowDirectionStyles().direction, 'rtl')
})
