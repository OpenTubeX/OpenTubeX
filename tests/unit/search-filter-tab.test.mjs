import assert from 'node:assert/strict'
import test from 'node:test'

import { getSearchFilterTabId } from '../../src/search-history.js'

const platforms = [
  { name: 'Electron', env: { IS_ELECTRON: 'true' }, expected: 'tab-1' },
  { name: 'Android', env: { IS_CAPACITOR: 'true' }, expected: 'tab-1' },
  { name: 'web', env: {}, expected: 'web' },
]

for (const { name, env, expected } of platforms) {
  test(`${name} stores search filters under the tab that runs the search`, () => {
    const originalEnv = process.env
    process.env = { ...env }
    try {
      assert.equal(getSearchFilterTabId('tab-1'), expected)
      assert.equal(getSearchFilterTabId(null), 'web')
    } finally {
      process.env = originalEnv
    }
  })
}
