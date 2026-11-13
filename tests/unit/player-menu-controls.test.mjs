import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getDefaultPlayerMenuControls,
  normalizeHiddenPlayerMenuControls,
  normalizePlayerMenuControls,
} from '../../src/renderer/helpers/playerMenuControls.js'

test('keeps a custom order and adds missing controls after their default neighbor', () => {
  const order = normalizePlayerMenuControls(['loop', 'unknown', 'loop', 'audioTracks', 1], false)
  assert.deepEqual(order.slice(0, 7), ['loop', 'abRepeat', 'screenshot', 'pictureInPicture', 'theatreMode', 'fullWindow', 'audioTracks'])
  assert.equal(order.at(-1), 'monoAudio')
  assert.deepEqual([...order].sort(), getDefaultPlayerMenuControls(false).sort())
})

test('hides only known controls, including ones with a setting of their own', () => {
  assert.deepEqual(normalizeHiddenPlayerMenuControls(null), [])
  assert.deepEqual(normalizeHiddenPlayerMenuControls(['ambientMode', 'unknown', 'lightsOff', 'ambientMode', 'sleepTimer']), ['ambientMode', 'lightsOff', 'sleepTimer'])
})
