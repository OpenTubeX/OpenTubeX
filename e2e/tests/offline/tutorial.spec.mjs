import { test, expect } from '../../helpers/app.mjs'

test.use({ showTutorial: true })

async function expectHighlightCenteredOn(page, targetSelector) {
  await expect.poll(async () => {
    const [highlight, target] = await Promise.all([
      page.locator('.tutorialHighlight').evaluate(element => element.getBoundingClientRect().toJSON()),
      page.locator(`${targetSelector}:visible`).evaluate(element => element.getBoundingClientRect().toJSON())
    ])

    return {
      x: Math.round(Math.abs(highlight.x + highlight.width / 2 - (target.x + target.width / 2))),
      y: Math.round(Math.abs(highlight.y + highlight.height / 2 - (target.y + target.height / 2)))
    }
  }).toEqual({ x: 0, y: 0 })
}

async function clickAppMenuItem(app, menuLabel, itemLabel) {
  await app.electronApp.evaluate(({ BrowserWindow, Menu }, { menuLabel, itemLabel }) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const menu = Menu.getApplicationMenu().items.find(item => item.label === menuLabel)
    menu.submenu.items.find(item => item.label === itemLabel).click(undefined, browserWindow)
  }, { menuLabel, itemLabel })
}

test('shows returning users only where settings moved', async ({ app, page }) => {
  const tutorial = page.getByRole('dialog', { name: 'Settings have moved' })
  await expect(tutorial).toBeVisible()
  const lastUsedVersion = await page.evaluate(() => localStorage.getItem('opentubex.lastUsedVersion'))
  expect(lastUsedVersion).toMatch(/^\d+\.\d+\.\d+(?:-|$)/)
  await expect(tutorial).toContainText('The cog in that menu opens all settings.')
  await expect(tutorial.locator('.tutorialProgress')).toHaveCount(0)
  await expectHighlightCenteredOn(page, '[data-tutorial="quick-settings"]')

  const tabCount = await page.locator('.tabBar .tab').count()
  await page.keyboard.press('Control+t')
  await expect(page.locator('.tabBar .tab')).toHaveCount(tabCount)

  await clickAppMenuItem(app, 'Tabs', 'New Tab')
  await expect(page.locator('.tabBar .tab')).toHaveCount(tabCount)

  const currentUrl = page.url()
  await clickAppMenuItem(app, 'File', 'Preferences')
  await clickAppMenuItem(app, 'Navigate', 'History')
  expect(page.url()).toBe(currentUrl)

  const initialWindowState = await app.electronApp.evaluate(({ BrowserWindow }) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    return {
      count: BrowserWindow.getAllWindows().length,
      zoom: browserWindow.webContents.getZoomLevel()
    }
  })
  await clickAppMenuItem(app, 'File', 'New Window')
  await clickAppMenuItem(app, 'View', 'Toggle Developer Tools')
  await clickAppMenuItem(app, 'View', 'Zoom In')
  await clickAppMenuItem(app, 'View', 'Toggle Full Screen')
  await clickAppMenuItem(app, 'Window', 'Minimize')
  await expect.poll(() => app.electronApp.evaluate(({ BrowserWindow }) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    return {
      count: BrowserWindow.getAllWindows().length,
      devToolsOpen: browserWindow.webContents.isDevToolsOpened(),
      fullscreen: browserWindow.isFullScreen(),
      minimized: browserWindow.isMinimized(),
      zoom: browserWindow.webContents.getZoomLevel()
    }
  })).toEqual({
    ...initialWindowState,
    devToolsOpen: false,
    fullscreen: false,
    minimized: false
  })

  const primaryAction = tutorial.getByRole('button', { name: 'Got it' })
  await expect(primaryAction).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(primaryAction).toBeFocused()

  await primaryAction.click()
  await expect(tutorial).toBeHidden()

  await clickAppMenuItem(app, 'Tabs', 'New Tab')
  await expect(page.locator('.tabBar .tab')).toHaveCount(tabCount + 1)

  await page.reload()
  await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
})

test('keeps the tutorial actions reachable in a short window', async ({ app, page }) => {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(800, 320)
  })

  const tutorial = page.getByRole('dialog', { name: 'Settings have moved' })
  await expect(tutorial.getByRole('button', { name: 'Got it' })).toBeVisible()
  await expect.poll(() => tutorial.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.top >= 0 && bounds.bottom <= window.innerHeight
  })).toBe(true)
})

test.describe('right-to-left layout', () => {
  test.use({ seed: { settings: { currentLocale: 'ar' } } })

  test('keeps the spotlight centered on physical target coordinates', async ({ page }) => {
    await expect(page.locator('.app')).toHaveClass(/isLocaleRightToLeft/)
    await expectHighlightCenteredOn(page, '[data-tutorial="quick-settings"]')
  })
})

test('walks new users through the essential controls', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
  await page.reload()

  const tutorial = page.locator('.tutorialCard')
  await expect(tutorial).toHaveAccessibleName('Welcome to OpenTubeX')
  await expect(tutorial.locator('.tutorialProgress span')).toHaveCount(5)

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Your library is always nearby')
  await expect(tutorial.getByRole('heading', { name: 'Your library is always nearby' })).toBeFocused()
  await expectHighlightCenteredOn(page, '[data-tutorial="navigation"]')

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Search or paste a link')
  await expectHighlightCenteredOn(page, '[data-tutorial="search"]')

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Keep pages open in tabs')
  await expectHighlightCenteredOn(page, '[data-tutorial="tabs"]')

  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Make it yours')
  await expectHighlightCenteredOn(page, '[data-tutorial="quick-settings"]')

  await tutorial.getByRole('button', { name: 'Finish' }).click()
  await expect(tutorial).toBeHidden()

  await page.reload()
  await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
})

test('highlights the mobile search button', async ({ app, page }) => {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(600, 700)
  })
  await page.evaluate(() => localStorage.setItem('opentubex.tutorial.audience', 'new'))
  await page.reload()

  const tutorial = page.locator('.tutorialCard')
  await tutorial.getByRole('button', { name: 'Next' }).click()
  await tutorial.getByRole('button', { name: 'Next' }).click()
  await expect(tutorial).toHaveAccessibleName('Search or paste a link')
  await expectHighlightCenteredOn(page, '.navSearchButton[data-tutorial="search"]')
})
