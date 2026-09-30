import assert from 'node:assert/strict'
import test from 'node:test'

import { addScrollbarAutoHide } from '../../src/renderer/helpers/scrollbarAutoHide.js'

function setup(context) {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const document = new EventTarget()
  const host = Object.assign(new EventTarget(), { ownerDocument: document })
  const scrollEventElement = new EventTarget()
  const bars = Array.from({ length: 2 }, () => {
    const classes = new Set()
    const writes = []
    return Object.assign(new EventTarget(), {
      classes,
      writes,
      classList: {
        toggle(name, enabled) {
          writes.push(enabled)
          if (enabled) classes.add(name)
          else classes.delete(name)
        }
      }
    })
  })
  const remove = addScrollbarAutoHide({
    host,
    scrollEventElement,
    scrollbarHorizontal: { scrollbar: bars[0] },
    scrollbarVertical: { scrollbar: bars[1] }
  })
  context.after(remove)
  return { document, host, scrollEventElement, bars, remove }
}

function pointer(target, type, properties = {}) {
  target.dispatchEvent(Object.assign(new Event(type), {
    pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true, ...properties
  }))
}

test('scroll bursts show once and hide only after the last activity', context => {
  const { scrollEventElement, bars } = setup(context)
  assert.deepEqual(bars[0].writes, [true])
  for (let frame = 0; frame < 60; frame++) {
    scrollEventElement.dispatchEvent(new Event('scroll'))
    context.mock.timers.tick(16)
  }
  for (const bar of bars) assert.deepEqual(bar.writes, [true, false])
  context.mock.timers.tick(1283)
  assert.equal(bars[0].classes.size, 0)
  context.mock.timers.tick(1)
  for (const bar of bars) assert.deepEqual(bar.writes, [true, false, true])
})

test('mouse and pen movement show idle bars; touch movement does not', context => {
  const { host, bars } = setup(context)
  pointer(host, 'pointermove', { pointerType: 'touch' })
  assert.equal(bars[0].classes.size, 1)
  pointer(host, 'pointermove')
  assert.equal(bars[0].classes.size, 0)
  context.mock.timers.tick(1300)
  pointer(host, 'pointermove', { pointerType: 'pen' })
  assert.equal(bars[0].classes.size, 0)
})

for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  test(`a held scrollbar stays visible until ${ending} and the idle delay`, context => {
    const { document, bars } = setup(context)
    pointer(bars[0], 'pointerdown')
    context.mock.timers.tick(3000)
    assert.equal(bars[0].classes.size, 0)
    pointer(document, 'pointerup', { pointerId: 2 })
    context.mock.timers.tick(1300)
    assert.equal(bars[0].classes.size, 0)
    pointer(ending === 'lostpointercapture' ? bars[0] : document, ending)
    context.mock.timers.tick(1299)
    assert.equal(bars[0].classes.size, 0)
    context.mock.timers.tick(1)
    assert.equal(bars[0].classes.size, 1)
  })
}

test('destroying a scrollbar cancels its timer and removes its activity listeners', context => {
  const { host, document, scrollEventElement, bars, remove } = setup(context)
  pointer(bars[0], 'pointerdown')
  remove()
  context.mock.timers.tick(2000)
  pointer(host, 'pointermove')
  pointer(bars[0], 'pointerdown')
  pointer(document, 'pointerup')
  scrollEventElement.dispatchEvent(new Event('scroll'))
  context.mock.timers.tick(2000)
  for (const bar of bars) assert.deepEqual(bar.writes, [true, false])
})
