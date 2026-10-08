import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const entries = await Promise.all(['overlayscrollbars.mjs', 'overlayscrollbars.esm.js', 'overlayscrollbars.cjs', 'overlayscrollbars.cjs.js'].map(async entry => [
  entry, await readFile(new URL(`../../node_modules/overlayscrollbars/${entry}`, import.meta.url), 'utf8')
]))

function setup(source, deferred = true) {
  const debounceSource = source.slice(source.indexOf('const debounce ='), source.indexOf('const hasOwnProperty ='))
  const mutationSource = source.slice(source.indexOf('  const onContentMutation ='), source.indexOf('  const onHostMutation ='))
  const observerStart = source.indexOf('const createObserversSetup =')
  const declarations = source.slice(source.indexOf('\n', observerStart), source.indexOf('  const _ =', observerStart))
  const frames = []
  const deadlines = []
  let measurements = 0
  let updates = 0
  let size = 0
  let measuredSize = 0
  const context = vm.createContext({
    deferredOption: deferred,
    from: Array.from,
    getDebouncer(delay) {
      assert.ok(delay === 0 || delay === 33)
      return callback => {
        const pending = { callback, active: true }
        const queue = delay === 0 ? frames : deadlines
        queue.push(pending)
        return () => { pending.active = false }
      }
    },
    D() {
      measurements++
      const changed = measuredSize !== size
      measuredSize = size
      return [size, changed]
    },
    setDirection() {},
    z(hints) { assert.equal(hints.xt, true); updates++ },
    e: undefined,
    r: undefined
  })
  vm.runInContext(`"use strict"; ${declarations}\n${debounceSource}\n${mutationSource}\ndeferContentMutation = deferredOption;\nthis.observe = onObservedContentMutation; this.destroy = destroyContentMutationDebounce`, context)
  function flush(pending) {
    for (const delivery of pending.splice(0)) if (delivery.active) delivery.callback()
  }
  return {
    observe: context.observe,
    destroy: context.destroy,
    resize: value => { size = value },
    measurements: () => measurements,
    updates: () => updates,
    frame: () => flush(frames),
    deadline: () => flush(deadlines)
  }
}

for (const [entry, source] of entries) {
  test(`${entry}: page content mutations and image events share one deferred size measurement`, () => {
    const fixture = setup(source)
    fixture.resize(100)
    for (let index = 0; index < 100; index++) fixture.observe(index % 2 === 0)
    assert.equal(fixture.measurements(), 0)
    fixture.frame()
    assert.equal(fixture.measurements(), 1)
    assert.equal(fixture.updates(), 1)
    fixture.deadline()
    assert.equal(fixture.measurements(), 1, 'the maximum-wait timer is cancelled after delivery')
  })

  test(`${entry}: unchanged content dimensions avoid full updates and settled geometry is measured later`, () => {
    const fixture = setup(source)
    fixture.observe(false)
    fixture.frame()
    assert.equal(fixture.updates(), 0)
    fixture.resize(100.25)
    fixture.observe(false)
    fixture.frame()
    assert.equal(fixture.updates(), 1)
    fixture.resize(100)
    fixture.observe(false)
    fixture.frame()
    assert.equal(fixture.updates(), 2)
  })

  test(`${entry}: the maximum-wait deadline measures content if animation frames are delayed`, () => {
    const fixture = setup(source)
    fixture.resize(100)
    fixture.observe(true)
    fixture.deadline()
    fixture.frame()
    assert.equal(fixture.measurements(), 1)
    assert.equal(fixture.updates(), 1)
  })

  test(`${entry}: destroying an observer cancels deferred content measurement without reading layout`, () => {
    const fixture = setup(source)
    fixture.resize(100)
    fixture.observe(false)
    fixture.destroy()
    fixture.frame()
    fixture.deadline()
    assert.equal(fixture.measurements(), 0)
    assert.equal(fixture.updates(), 0)
  })

  test(`${entry}: ordinary nested observers and explicit pending-record measurements remain synchronous`, () => {
    const ordinary = setup(source, false)
    ordinary.resize(100)
    ordinary.observe(false)
    assert.equal(ordinary.measurements(), 1)
    assert.equal(ordinary.updates(), 1)
    const forced = setup(source)
    forced.resize(100)
    assert.equal(forced.observe(false, true).xt, true)
    assert.equal(forced.measurements(), 1)
    assert.equal(forced.updates(), 0, 'the caller performs its own explicit update')
  })
}
