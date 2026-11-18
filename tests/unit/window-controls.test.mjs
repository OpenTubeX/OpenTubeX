import assert from 'node:assert/strict'
import test from 'node:test'

import { parseWindowButtonLayout } from '../../src/renderer/helpers/windowControls.js'

test('window button layouts split into the controls on each side', () => {
  assert.deepEqual(parseWindowButtonLayout(':minimize,maximize,close'), {
    left: [],
    right: ['minimize', 'maximize', 'close']
  })
  assert.deepEqual(parseWindowButtonLayout('close,minimize,maximize:'), {
    left: ['close', 'minimize', 'maximize'],
    right: []
  })
})

test('window button layouts skip entries without a window control', () => {
  // GNOME's default only has a close button.
  assert.deepEqual(parseWindowButtonLayout('appmenu:close'), { left: [], right: ['close'] })
  assert.deepEqual(parseWindowButtonLayout('icon,spacer:minimize,,maximize,close,close'), {
    left: [],
    right: ['minimize', 'maximize', 'close']
  })
  assert.deepEqual(parseWindowButtonLayout(''), { left: [], right: [] })
})
