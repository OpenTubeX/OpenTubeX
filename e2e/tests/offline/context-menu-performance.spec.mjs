import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

import { test, expect, openNewWindowFromTabBar, waitForAppReady } from '../../helpers/app.mjs'
import { DBActions } from '../../../src/constants.js'
import { DEFAULT_SEARCH_ENGINES } from '../../../src/searchEngines.js'

/** Hold a real settings write behind a separate SQLite transaction. */
async function holdSettingsWrite(app, page) {
  const database = new DatabaseSync(path.join(app.userDataDir, 'library.sqlite'))
  database.exec('BEGIN IMMEDIATE')
  await page.evaluate(action => {
    window.__contextMenuSettingsWrite = window.ftElectron.dbSettings(action, {
      _id: 'contextMenuPerformanceProbe', value: true,
    })
  }, DBActions.GENERAL.UPSERT)
  const queuedRead = page.evaluate(action => window.ftElectron.dbSettings(action), DBActions.GENERAL.FIND)
  const release = async () => {
    database.exec('ROLLBACK')
    database.close()
    await page.evaluate(() => window.__contextMenuSettingsWrite)
    await queuedRead
  }
  try {
    const blocked = await Promise.race([
      queuedRead.then(() => false),
      new Promise(resolve => setTimeout(() => resolve(true), 50)),
    ])
    expect(blocked, 'the settings datastore must actually be busy').toBe(true)
  } catch (error) {
    await release()
    throw error
  }
  return release
}

test('selected-text context menu opens while unrelated settings writes wait for storage', async ({ app, page }) => {
  await page.evaluate(() => window.ftElectron.contextMenu.open({ selectionText: 'warm up' }))
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const point = await page.evaluate(() => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'selected text under load'
    paragraph.style.cssText = 'position:fixed;top:120px;left:40px;width:300px;z-index:19000;background:#000'
    document.body.append(paragraph)
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
    const bounds = paragraph.getBoundingClientRect()
    return { x: bounds.left + 10, y: bounds.top + 5 }
  })

  const release = await holdSettingsWrite(app, page)
  try {
    await page.mouse.click(point.x, point.y, { button: 'right' })
    const menu = page.getByRole('menu', { name: 'Context Menu' })
    await expect(menu).toBeVisible({ timeout: 1500 })
    await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeEnabled()
    await expect(menu.getByRole('menuitem', { name: 'Search "selected text under load" in a New Tab', exact: true })).toBeVisible()
  } finally {
    await release()
    await cdp.detach()
  }
})

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
