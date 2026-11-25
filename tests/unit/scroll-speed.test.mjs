import assert from 'node:assert/strict'
import test from 'node:test'

import { addScrollSpeedHandler } from '../../src/renderer/helpers/scrollSpeed.js'

test('custom scroll speed moves right-to-left scrollers both ways', t => {
  const { getComputedStyle, WheelEvent } = globalThis
  globalThis.getComputedStyle = () => ({ direction: 'rtl', overscrollBehaviorX: 'auto' })
  globalThis.WheelEvent = { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 }
  t.after(() => Object.assign(globalThis, { getComputedStyle, WheelEvent }))

  // Right-to-left elements scroll from 0 at the start to -200 at the end.
  const wheel = (scrollLeft, deltaX) => {
    let handleWheel
    let left = null
    const element = {
      scrollLeft,
      scrollTop: 0,
      scrollWidth: 300,
      clientWidth: 100,
      scrollHeight: 100,
      clientHeight: 100,
      ownerDocument: {},
      addEventListener: (type, handler) => { if (type === 'wheel') handleWheel = handler },
      scrollTo: options => { left = options.left }
    }
    addScrollSpeedHandler(element, () => 200)
    handleWheel({ deltaX, deltaY: 0, deltaMode: 0, preventDefault () {} })
    return left
  }

  assert.equal(wheel(-100, 20), -60)
  assert.equal(wheel(-100, -20), -140)
  assert.equal(wheel(0, -20), -40)
  assert.equal(wheel(0, 20), null, 'the start is a boundary')
})
