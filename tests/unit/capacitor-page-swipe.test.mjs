import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findSwipeTab } from '../../src/renderer/helpers/capacitorPageSwipe.js'

test('swiping visits adjacent unloaded and mounting tabs without skipping', () => {
  const tabs = [
    { id: 'first', loadState: 'loaded' },
    { id: 'unloaded', loadState: 'unloaded' },
    { id: 'mounting', loadState: 'mounting' },
    { id: 'last', loadState: 'loaded' }
  ]

  assert.equal(findSwipeTab(tabs, 'first', 1)?.id, 'unloaded')
  assert.equal(findSwipeTab(tabs, 'last', -1)?.id, 'mounting')
  assert.equal(findSwipeTab(tabs, 'last', 1), null)
  assert.equal(findSwipeTab(tabs, 'unloaded', 1), null)
})
