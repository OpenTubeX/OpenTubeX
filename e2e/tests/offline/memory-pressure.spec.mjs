import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

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

test('automatic unload badges @scale distinguish manual tabs and clear on activation', async ({ page }, testInfo) => {
  await expect(page.locator('.topNav')).toBeVisible()
  const original = (await page.evaluate(() => window.ftElectron.tabs.getState())).activeTabId
  const auto = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/history', makeActive: true }))
  await expect(page.locator(`.tabContent[data-tab-id="${auto.id}"] > *`).first()).toBeAttached()
  await page.locator(`.tab[data-tab-id="${original}"]`).click()
  await expect(page.locator(`.tabContent[data-tab-id="${original}"]`)).toHaveAttribute('aria-hidden', 'false')
  const manual = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/playlists', makeActive: false, lazyLoad: true }))
  expect(await page.evaluate(() => window.ftElectron.tabs.unloadLeastRecentlyUsed(100))).toBe(1)
  const autoTab = page.locator(`.tab[data-tab-id="${auto.id}"]`)
  const manualTab = page.locator(`.tab[data-tab-id="${manual.id}"]`)
  await expect(autoTab.locator('.autoUnloadIcon')).toBeVisible()
  await expect(autoTab).toHaveAttribute('aria-label', /Automatically unloaded to free memory/)
  const tabBounds = await autoTab.boundingBox()
  const badgeBounds = await autoTab.locator('.autoUnloadIcon').boundingBox()
  expect(tabBounds, 'automatically unloaded tab is rendered').not.toBeNull()
  expect(badgeBounds, 'automatic unloading badge is rendered').not.toBeNull()
  expect(badgeBounds.x).toBeGreaterThanOrEqual(tabBounds.x)
  expect(badgeBounds.y).toBeGreaterThanOrEqual(tabBounds.y)
  expect(badgeBounds.x + badgeBounds.width).toBeLessThanOrEqual(tabBounds.x + tabBounds.width)
  expect(badgeBounds.y + badgeBounds.height).toBeLessThanOrEqual(tabBounds.y + tabBounds.height)
  await expect(manualTab.locator('.autoUnloadIcon')).toHaveCount(0)
  await testInfo.attach('automatic and manually unloaded tabs - Material', { body: await page.locator('.tabsContent').screenshot(), contentType: 'image/png' })
  await page.evaluate(() => window.$store.dispatch('updateIconPack', 'remix'))
  await expect(autoTab.locator('.autoUnloadIcon')).toHaveAttribute('data-icon-pack', 'remix')
  await testInfo.attach('automatic and manually unloaded tabs - Remix', { body: await page.locator('.tabsContent').screenshot(), contentType: 'image/png' })
  await autoTab.click()
  await expect(autoTab.locator('.autoUnloadIcon')).toHaveCount(0)
  await expect(page.locator(`.tabContent[data-tab-id="${auto.id}"] > *`).first()).toBeAttached()
})

test('automatic unloading settings @scale can be changed and disabled', async ({ page, attachScreenshot }) => {
  await expect(page.locator('.topNav')).toBeVisible()
  const general = await goToSettingsSection(page, 'general')
  await expect(general.locator('[data-setting-key="autoUnloadTabs"]')).toHaveCount(0)
  for (const label of ['Automatically unload tabs', 'Memory threshold', 'Tabs to unload']) {
    await goToSettingsSection(page, 'general')
    await page.getByRole('searchbox', { name: 'Search settings' }).fill(label)
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator('.settingsSearchTarget')).toContainText(label)
  }
  await expect(page.getByRole('heading', { name: 'Automatically unload tabs', exact: true })).toBeVisible()
  const toggle = page.getByRole('checkbox', { name: /^Automatically unload tabs/ })
  await expect(toggle).toBeChecked()
  const threshold = page.locator('.select').filter({ hasText: 'Memory threshold' })
  const percentage = page.locator('.select').filter({ hasText: 'Tabs to unload' })
  await threshold.locator('.select-text').click()
  await page.getByRole('option', { name: '70%', exact: true }).click()
  await percentage.locator('.select-text').click()
  await page.getByRole('option', { name: '25%', exact: true }).click()
  await expect.poll(() => page.evaluate(() => [window.$store.getters.getAutoUnloadMemoryThreshold, window.$store.getters.getAutoUnloadTabPercentage])).toEqual([70, 25])
  await page.locator('[data-setting-key="autoUnloadTabs"] .switch-label').click()
  await expect(threshold.locator('.select-text')).toBeDisabled()
  await expect(percentage.locator('.select-text')).toBeDisabled()
  await expect.poll(() => page.evaluate(() => window.$store.getters.getAutoUnloadTabs)).toBe(false)
  await page.reload()
  await goToSettingsSection(page, 'advanced')
  await expect(toggle).not.toBeChecked()
  await expect(threshold.locator('.select-text')).toBeDisabled()
  await page.locator('[data-setting-key="autoUnloadTabs"] .switch-label').click()
  await expect(threshold.locator('.selectedValue')).toHaveText('70%')
  await expect(percentage.locator('.selectedValue')).toHaveText('25%')
  await expect(threshold.locator('.select-text')).toBeEnabled()
  await expect(percentage.locator('.select-text')).toBeEnabled()
  await page.getByRole('heading', { name: 'Automatically unload tabs', exact: true }).scrollIntoViewIfNeeded()
  const alignment = await page.locator('[data-setting-key="autoUnloadTabs"]').evaluate(element => {
    const toggle = element.getBoundingClientRect()
    const selects = element.closest('.sectionBody').querySelector('.switchGrid').getBoundingClientRect()
    return {
      centerOffset: Math.abs(toggle.left + toggle.width / 2 - selects.left - selects.width / 2),
      verticalGap: selects.top - toggle.bottom
    }
  })
  expect(alignment.centerOffset).toBeLessThanOrEqual(1)
  // Fractional zoom can differ by a few millionths of a CSS pixel at a shared edge.
  expect(alignment.verticalGap).toBeGreaterThanOrEqual(-0.01)
  await attachScreenshot('automatic tab unloading settings')
})
