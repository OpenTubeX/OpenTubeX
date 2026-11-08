import { test, expect, sel, abortUnmockedRequest } from '../../helpers/app.mjs'

test.describe('tab switcher hold delay', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    await page.evaluate(async () => {
      await window.ftElectron.tabs.create({ route: '/history', makeActive: false, lazyLoad: true })
      await window.ftElectron.tabs.create({ route: '/about', makeActive: false, lazyLoad: true })
    })
    await expect(page.locator(sel.tabs)).toHaveCount(3)
    await page.clock.install()
    await page.clock.pauseAt(new Date(Date.now() + 1000))
  })

  test('accumulates and reverses selection before the menu opens', async ({ page }) => {
    const ids = await page.locator(sel.tabs).evaluateAll(tabs => tabs.map(tab => tab.dataset.tabId))
    await page.keyboard.down('Control')
    await page.keyboard.press('Tab')
    await page.clock.runFor(100)
    await expect(page.locator('.tabSwitcher')).toHaveCount(0)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await page.clock.runFor(50)
    await expect(page.locator('.tabSwitcher')).toBeVisible()
    await expect(page.locator('.tabSwitcherItem.selected')).toHaveAttribute('id', `tab-switcher-option-${ids[1]}`)
    await page.keyboard.up('Control')
    await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', ids[1])
    await expect(page.locator('.tabSwitcher')).toHaveCount(0)
  })

  test('scrolls the held selection into view after wrapping', { tag: '@scale' }, async ({ page }) => {
    await page.clock.resume()
    await page.evaluate(async () => {
      for (let i = 0; i < 25; i++) {
        await window.ftElectron.tabs.create({ route: '/history', makeActive: false, lazyLoad: true })
      }
    })
    await expect(page.locator(sel.tabs)).toHaveCount(28)
    await page.keyboard.down('Control')
    try {
      await page.keyboard.press('Shift+Tab')
      await expect(page.locator('.tabSwitcher')).toBeVisible()
      const selected = page.locator('.tabSwitcherItem.selected')
      await expect(selected).toBeInViewport({ ratio: 1 })
      await page.keyboard.press('Tab')
      await expect(page.locator('.tabSwitcherItem').first()).toHaveClass(/selected/)
      await expect(selected).toBeInViewport({ ratio: 1 })
    } finally {
      await page.keyboard.press('Escape')
      await page.keyboard.up('Control')
    }
  })

  for (const cancellation of ['Escape', 'blur']) {
    test(`${cancellation} cancels a pending switch without opening the menu later`, async ({ page }) => {
      const activeId = await page.locator(sel.activeTab).getAttribute('data-tab-id')
      await page.keyboard.down('Control')
      await page.keyboard.press('Tab')
      if (cancellation === 'Escape') await page.keyboard.press('Escape')
      else await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      await page.keyboard.up('Control')
      await page.clock.runFor(500)
      await expect(page.locator('.tabSwitcher')).toHaveCount(0)
      await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', activeId)
      await page.keyboard.press('Control+Shift+Tab')
      await expect(page.locator(sel.activeTab)).toContainText('About')
    })
  }
})
