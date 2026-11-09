import assert from 'node:assert/strict'
import test from 'node:test'

import { getSearchFilterTabId } from '../../src/search-history.js'

test('Android stores search filters under the tab that runs the search', () => {
  const originalEnv = process.env
  process.env = { IS_CAPACITOR: 'true' }
  try {
    assert.equal(getSearchFilterTabId('tab-1'), 'tab-1')
    assert.equal(getSearchFilterTabId(null), 'web')
  } finally {
    process.env = originalEnv
  }
})
