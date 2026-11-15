import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CONTROL_BAR_BUTTON_DEFINITIONS,
  getControlBarButtonDefinitions,
  getDefaultControlBarButtons,
  getRemovedControlBarButtons,
  normalizeControlBarButtons,
} from '../../src/renderer/helpers/controlBarButtons.js'

test('mobile only offers the buttons of its compact control bar', () => {
  assert.deepEqual(getControlBarButtonDefinitions(true).map(({ id }) => id), ['chapters', 'captions', 'menu', 'pictureInPicture', 'fullscreen'])
  assert.deepEqual(getControlBarButtonDefinitions(false).map(({ id }) => id), CONTROL_BAR_BUTTON_DEFINITIONS.map(({ id }) => id))
  assert.deepEqual(normalizeControlBarButtons(['fullscreen', 'theatreMode', 'menu', 'autoplay'], true), ['fullscreen', 'menu'])
})

test('the player menu offers the buttons that are not on the full control bar', () => {
  const menuControls = ['quality', 'audioTracks', 'playbackRate', 'loop']
  assert.deepEqual(getRemovedControlBarButtons(getDefaultControlBarButtons(false), false), [...menuControls, 'timestampNote'])
  assert.deepEqual(getRemovedControlBarButtons(['captions', 'menu', 'fullscreen'], false), ['chapters', ...menuControls, 'screenshot', 'timestampNote', 'autoplay', 'pictureInPicture', 'theatreMode', 'fullWindow'])
  assert.deepEqual(getRemovedControlBarButtons(['quality', 'loop', ...getDefaultControlBarButtons(false)], false), ['audioTracks', 'playbackRate', 'timestampNote'])
  // Capacitor tablets and TVs use the full control bar with the compact buttons,
  // and have no full-window mode
  assert.deepEqual(getRemovedControlBarButtons(getDefaultControlBarButtons(true), true), [...menuControls, 'screenshot', 'timestampNote', 'autoplay', 'theatreMode'])
})

test('keeps a custom order, discards invalid entries and always keeps the menu', () => {
  assert.deepEqual(normalizeControlBarButtons(['fullscreen', null, 'captions', 'fullscreen', 'unknown', 1, 'menu'], false), ['fullscreen', 'captions', 'menu'])
  assert.deepEqual(normalizeControlBarButtons(['fullscreen'], false), ['fullscreen', 'menu'])
  assert.deepEqual(normalizeControlBarButtons([], true), ['menu'])
})
