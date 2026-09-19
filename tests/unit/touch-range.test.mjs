import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = (await readFile(new URL('../../src/renderer/helpers/touchRange.js', import.meta.url), 'utf8')).replaceAll('export ', '')
for (const end of ['pointerup', 'pointercancel', 'lostpointercapture', 'scroll']) {
  test(`touch ranges accept accessibility changes after ${end}`, () => {
    const handlers = new Map()
    const input = {
      value: '50', min: '0', max: '100', style: {},
      addEventListener: (name, callback) => handlers.set(name, callback),
      removeEventListener: name => handlers.delete(name),
      setPointerCapture() {}, focus() {}, dispatchEvent() {},
      getBoundingClientRect: () => ({ left: 0, width: 100 }),
    }
    const attach = vm.runInNewContext(`${source}; attachTouchRange`, { Event, getComputedStyle: () => ({ direction: 'ltr' }) })
    const cleanup = attach(input)
    const pointer = { pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: 50, clientY: 0, preventDefault() {} }
    handlers.get('pointerdown')(pointer)
    if (end === 'scroll') {
      handlers.get('pointermove')({ ...pointer, clientY: 30 })
      input.value = '70'
      let prevented = false
      handlers.get('input')({ isTrusted: true, stopImmediatePropagation() { prevented = true } })
      assert.equal(prevented, true, 'native changes during scrolling remain suppressed')
    }
    handlers.get(end === 'scroll' ? 'pointerup' : end)(pointer)
    input.value = '80'
    let prevented = false
    handlers.get('input')({ isTrusted: true, stopImmediatePropagation() { prevented = true } })
    assert.equal(prevented, false)
    assert.equal(input.value, '80')
    cleanup()
  })
}
