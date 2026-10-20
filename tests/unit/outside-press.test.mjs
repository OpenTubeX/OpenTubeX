import assert from 'node:assert/strict'
import test from 'node:test'
import { listenForOutsidePress } from '../../src/renderer/helpers/outsidePress.js'

test('a press closes popups only once it ends, not when Android claims it for Back', () => {
  const listeners = new Map()
  globalThis.document = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type),
  }
  const presses = []
  const stop = listenForOutsidePress(event => presses.push(event.target))
  const dispatch = (type, pointerId, target) => listeners.get(type)?.({ type, pointerId, target })
  try {
    dispatch('pointerdown', 1, 'edge')
    dispatch('pointercancel', 1)
    assert.deepEqual(presses, [])
    dispatch('pointerdown', 2, 'page')
    dispatch('pointerup', 2, 'elsewhere')
    assert.deepEqual(presses, ['page'], 'the handler receives the press start')
    stop()
    assert.equal(listeners.size, 0)
  } finally {
    delete globalThis.document
  }
})
