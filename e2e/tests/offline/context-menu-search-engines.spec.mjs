import { test, expect, openNewWindowFromTabBar, waitForAppReady } from '../../helpers/app.mjs'
import { DBActions } from '../../../src/constants.js'
import { DEFAULT_SEARCH_ENGINES } from '../../../src/searchEngines.js'

test('search-engine menu snapshots follow saves and resets across windows', async ({ app, page }) => {
  const otherWindow = await openNewWindowFromTabBar(app, page)
  await waitForAppReady(otherWindow)
  const menuForSelection = () => otherWindow.evaluate(() => window.ftElectron.contextMenu.open({ selectionText: 'fresh settings' }))
  expect((await menuForSelection()).items.some(item => item.label?.startsWith('Search with'))).toBe(false)

  for (const enabled of [true, false, true]) {
    await page.evaluate(({ action, value }) => window.ftElectron.dbSettings(action, {
      _id: 'contextMenuSearchEngines', value,
    }), {
      action: DBActions.GENERAL.UPSERT,
      value: JSON.stringify(DEFAULT_SEARCH_ENGINES.map(engine => ({ ...engine, enabled: engine.id === 'duckduckgo' && enabled }))),
    })
    const menu = await menuForSelection()
    expect(menu.items.some(item => item.label === 'Search with DuckDuckGo')).toBe(enabled)
    expect(await otherWindow.evaluate(() => window.ftElectron.resolveFavicon('https://duckduckgo.com/?q=%s'))).toBe(
      enabled ? 'https://duckduckgo.com/favicon.ico' : ''
    )
  }

  await page.evaluate(action => window.ftElectron.dbSettings(action, 'contextMenuSearchEngines'), DBActions.GENERAL.DELETE)
  expect((await menuForSelection()).items.some(item => item.label?.startsWith('Search with'))).toBe(false)
  expect(await otherWindow.evaluate(() => window.ftElectron.resolveFavicon('https://duckduckgo.com/?q=%s'))).toBe('')
})
