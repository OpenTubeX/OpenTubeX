import assert from 'node:assert/strict'
import test from 'node:test'

import { isTabActivatable } from '../../src/main/tabs/tabAvailability.js'

const tab = { id: 'video-tab' }

test('reports normal tabs as activatable', () => {
  assert.equal(isTabActivatable(tab, new Set(), new Set()), true)
})

test('rejects tabs that cannot be activated', () => {
  assert.equal(isTabActivatable(undefined, new Set(), new Set()), false)
  assert.equal(isTabActivatable(
    { ...tab, isTransferStaged: true },
    new Set(),
    new Set()
  ), false)
  assert.equal(isTabActivatable(tab, new Set([tab.id]), new Set()), false)
  assert.equal(isTabActivatable(tab, new Set(), new Set([tab.id])), false)
})
