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
    scrollbars: bars
  })
  context.after(remove)
  return { document, host, scrollEventElement, bars, remove }
}

function pointer(target, type, properties = {}) {
  target.dispatchEvent(Object.assign(new Event(type), {
    pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true, ...properties
  }))
}

for (const ending of ['pointerup', 'lostpointercapture']) {
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
