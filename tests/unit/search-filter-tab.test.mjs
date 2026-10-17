import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { getSearchFilterTabId } from '../../src/search-history.js'

const componentsUrl = new URL('../../src/renderer/components/', import.meta.url)

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

test('the filter dialog and the search bar resolve the same tab', async () => {
  for (const path of ['FtSearchFilters/FtSearchFilters.vue', 'TopNav/TopNav.vue']) {
    const source = await readFile(new URL(path, componentsUrl), 'utf8')
    assert.match(source, /getSearchFilterTabId\(store\.getters\.getPresentedTabId\)/, path)
  }
})
