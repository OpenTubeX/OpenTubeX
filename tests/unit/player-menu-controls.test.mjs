import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getDefaultPlayerMenuControls,
  normalizeHiddenPlayerMenuControls,
  normalizePlayerMenuControls,
} from '../../src/renderer/helpers/playerMenuControls.js'

test('keeps a custom order and adds missing controls after their default neighbor', () => {
  const order = normalizePlayerMenuControls(['loop', 'unknown', 'loop', 'audioTracks', 1], false)
  // The controls that follow loop by default keep following it, before the next custom entry.
  const defaults = getDefaultPlayerMenuControls(false)
  const afterLoop = defaults.slice(defaults.indexOf('loop') + 1)
  assert.deepEqual(order.slice(0, afterLoop.length + 2), ['loop', ...afterLoop, 'audioTracks'])
  assert.equal(order.at(-1), 'monoAudio')
  assert.deepEqual([...order].sort(), getDefaultPlayerMenuControls(false).sort())
})

test('hides only known controls, including ones with a setting of their own', () => {
  assert.deepEqual(normalizeHiddenPlayerMenuControls(null), [])
  assert.deepEqual(normalizeHiddenPlayerMenuControls(['ambientMode', 'unknown', 'lightsOff', 'ambientMode', 'sleepTimer']), ['ambientMode', 'lightsOff', 'sleepTimer'])
})
