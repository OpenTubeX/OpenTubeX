import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/helpers/overlayScrollbars.js', import.meta.url), 'utf8')
const resizeFunction = source.slice(source.indexOf('function reconcileScrollbarOnResize('), source.indexOf('/**\n * OverlayScrollbars applies'))

function setup() {
  let callback
  let frame
  let updates = 0
  const element = { clientHeight: 100, scrollHeight: 300, scrollTop: 0 }
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
  vm.runInContext(`${resizeFunction}\nthis.reconcile = reconcileScrollbarOnResize`, context)
  context.reconcile(element, instance)
  return { element, updates: () => updates, resize: () => { callback(); frame() } }
}

test('nested resize reconciliation leaves ordinary measurements to the library observer', () => {
  const fixture = setup()
  fixture.resize() // Initial observer delivery.
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
