import { test, expect } from '../../helpers/app.mjs'

test('unloads the least recently used background tabs to free memory', async ({ page }) => {
  await expect(page.locator('.topNav')).toBeVisible()
  const heap = await page.evaluate(() => window.ftElectron.getHeapStatistics())
  expect(heap.usedHeapSize).toBeGreaterThan(0)
  expect(heap.heapSizeLimit).toBeGreaterThan(heap.usedHeapSize)

  const { activeTabId } = await page.evaluate(() => window.ftElectron.tabs.getState())
  const content = tabId => page.locator(`.tabContent[data-tab-id="${tabId}"] > *`)
  const tabIds = []
  for (const route of ['/history', '/playlists', '/about']) {
    const { id } = await page.evaluate(route => window.ftElectron.tabs.create({ route, makeActive: true }), route)
    await expect(content(id).first()).toBeAttached()
    tabIds.push(id)
  }
  await page.locator(`.tab[data-tab-id="${activeTabId}"]`).click()
  await expect(page.locator(`.tabContent[data-tab-id="${activeTabId}"]`)).toHaveAttribute('aria-hidden', 'false')
  // Main keeps the previously presented tab loaded until the renderer reports
  // the switch, which arrives asynchronously after the DOM update.
  await expect.poll(() => page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.presentedTabId))).toBe(activeTabId)

  expect(await page.evaluate(() => window.ftElectron.tabs.unloadLeastRecentlyUsed())).toBe(2)
  await expect(content(tabIds[0])).toHaveCount(0)
  await expect(content(tabIds[1])).toHaveCount(0)
  await expect(content(tabIds[2]).first()).toBeAttached()
  await expect(content(activeTabId).first()).toBeAttached()
})
