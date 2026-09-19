import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = (await readFile(new URL('../../src/renderer/helpers/player/androidFullscreenTransition.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace('export function', 'function')
function fixture() {
  const nodes = new Set()
  const classes = new Set()
  const orientations = []
  const timers = new Map()
  let timerId = 0
  let playerOpen = true
  const document = Object.assign(new EventTarget(), {
    createElement: () => ({ setAttribute() {}, append() {}, remove() { nodes.delete(this) } }),
    body: { append: node => nodes.add(node) },
    documentElement: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } },
    querySelector: selector => playerOpen || (!selector.includes(':not') && nodes.size) ? {} : null,
  })
  const begin = vm.runInNewContext(`${source}; beginAndroidFullscreenTransition`, {
    setTimeout: callback => { timers.set(++timerId, callback); return timerId },
    clearTimeout: id => timers.delete(id),
    document, Event, setFullscreenOrientation: async value => orientations.push(value),
  })
  return { begin, nodes, classes, orientations, document, timers, ready() { document.dispatchEvent(new Event('nativefullscreenready')) }, change(value) { playerOpen = value; document.dispatchEvent(new Event('fullscreenchange')) } }
}

test('fullscreen video replacement retains the cover and orientation until the next player opens', () => {
  const f = fixture()
  const finish = f.begin('Loading', 'poster.webp')
  f.change(false)
  assert.equal(f.nodes.size, 1)
  assert.ok(f.classes.has('nativePlaybackScreen'))
  assert.deepEqual(f.orientations, [])
  f.change(true)
  assert.equal(f.nodes.size, 1, 'presentation request does not mean native show succeeded')
  f.ready()
  assert.equal(f.nodes.size, 0)
  assert.deepEqual(f.orientations, [])
  finish()
  assert.deepEqual(f.orientations, [])
})

test('failed loading, leaving the tab, and disposal can end the fullscreen handoff idempotently', () => {
  const f = fixture()
  const finish = f.begin('Loading')
  f.change(false)
  finish()
  finish()
  assert.equal(f.nodes.size, 0)
  assert.equal(f.classes.has('nativePlaybackScreen'), false)
  assert.deepEqual(f.orientations, [false])
})

for (const reason of ['Back', 'timeout']) {
  test(`a stalled fullscreen replacement can be cancelled by ${reason}`, () => {
    const f = fixture()
    let cancelled = 0
    f.begin('Loading', null, () => { cancelled++ })
    f.change(false)
    if (reason === 'Back') {
      const event = new Event('keydown', { cancelable: true })
      Object.defineProperty(event, 'key', { value: 'Escape' })
      f.document.dispatchEvent(event)
      assert.equal(event.defaultPrevented, true)
    } else {
      assert.equal(f.timers.size, 1)
      for (const callback of [...f.timers.values()]) callback()
    }
    assert.equal(cancelled, 1)
    assert.equal(f.nodes.size, 0)
    assert.equal(f.timers.size, 0)
    assert.deepEqual(f.orientations, [false])
  })
}
