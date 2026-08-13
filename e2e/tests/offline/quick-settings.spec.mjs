import { test, expect } from '../../helpers/app.mjs'

test.describe('quick settings menu', () => {
  test('fits a maximized 1080p window and spaces both sliders consistently', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1920, height: 1080 })
    })
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeGreaterThanOrEqual(1000)

    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    await expect(menu).toBeVisible()

    expect(await menu.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true)

    const sliders = menu.locator('.sliderGroup .pure-material-slider')
    await expect(sliders).toHaveCount(2)
    const gaps = await sliders.evaluateAll(elements => elements.map(element => {
      const label = element.querySelector('.label')
      const input = element.querySelector('.input')
      const labelBounds = label.getBoundingClientRect()
      const inputBounds = input.getBoundingClientRect()
      return inputBounds.top - labelBounds.bottom
    }))
    expect(Math.abs(gaps[0] - gaps[1])).toBeLessThanOrEqual(1)
  })

  test('stays inside a short viewport below horizontal tabs', async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1280, height: 720 })
    })
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(720)

    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const tabBar = page.locator('.tabBar:not(.vertical)')
    await expect(menu).toBeVisible()
    await expect(tabBar).toBeVisible()

    const [menuBounds, tabBarBounds] = await Promise.all([
      menu.evaluate(element => element.getBoundingClientRect().toJSON()),
      tabBar.evaluate(element => element.getBoundingClientRect().toJSON())
    ])
    expect(menuBounds.top).toBeGreaterThanOrEqual(tabBarBounds.bottom)
    expect(menuBounds.bottom).toBeLessThanOrEqual(720)
  })

  test('keeps paired selects aligned and shows locale completeness', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const pairs = menu.locator('.selectPair')
    await expect(pairs).toHaveCount(2)

    for (const pair of await pairs.all()) {
      const selects = pair.locator('.quickSelect')
      await expect(selects).toHaveCount(2)
      const [first, second] = await selects.evaluateAll(elements => elements.map(element => {
        const { x, y, width } = element.getBoundingClientRect()
        return { x, y, width }
      }))
      expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1)
      expect(second.x).toBeGreaterThan(first.x + first.width)
    }

    await menu.getByRole('combobox', { name: 'Language preference' }).click()
    await expect(page.locator('.selectDropdown')).toContainText('English (US) (100%)')
  })

  test('keeps the menu open when Escape closes a select', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const themeSelect = menu.getByRole('combobox', { name: 'Base Theme' })

    await themeSelect.click()
    await expect(page.locator('.selectDropdown')).toBeVisible()
    await themeSelect.press('Escape')

    await expect(page.locator('.selectDropdown')).toBeHidden()
    await expect(menu).toBeVisible()
  })

  test('stays open when the application window loses focus', async ({ app, page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    await expect(menu).toBeVisible()

    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.blur())
    await expect(menu).toBeVisible()
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus())
    await expect(menu).toBeFocused()

    await page.locator('.topNav .logo').click()
    await expect(menu).toBeHidden()
  })

  test('opens About and switches to Settings from the quick menu', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'About' }).click()

    const aboutWindow = page.getByRole('dialog', { name: 'About' })
    await expect(aboutWindow).toBeVisible()
    await expect(aboutWindow.locator('.settingsBreadcrumb')).toContainText('About')
    await expect(aboutWindow.locator('.settingsMenu')).toHaveCount(0)

    await page.locator('.profileTrigger').click()
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'All Settings' }).click()

    const settingsWindow = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(settingsWindow).toBeVisible()
    await expect(settingsWindow.locator('.settingsMenu')).toBeVisible()
  })
})

test.describe('quick distraction settings', () => {
  test.use({ seed: { settings: { playNextVideo: true } } })

  test('turns off autoplay when recommended videos are hidden', async ({ page }) => {
    await page.locator('.profileTrigger').click()

    const autoplay = page.getByRole('checkbox', { name: 'Autoplay Recommended Videos' })
    await expect(autoplay).toBeChecked()
    await page.locator('label.switch-label').filter({ hasText: 'Hide Recommended Videos' }).click()

    await expect(autoplay).not.toBeChecked()
    await expect(autoplay).toBeDisabled()
  })
})

test.describe('quick settings focus after control updates', () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'dark',
        highlightChangedSettings: true
      }
    }
  })

  test('stays open when a reset control removes itself', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const reset = menu.getByRole('button', { name: 'Reset this setting to its default' }).first()
    await expect(reset).toBeVisible()

    await reset.click()

    await expect(reset).toHaveCount(0)
    await expect(menu).toBeVisible()
  })

  test('stays open when a switch adds its reset control', async ({ page }) => {
    await page.locator('.profileTrigger').click()
    const menu = page.locator('.quickSettingsMenu')
    const hideComments = page.getByRole('checkbox', { name: 'Hide Comments' })

    await menu.locator('label.switch-label').filter({ hasText: 'Hide Comments' }).click()

    await expect(hideComments).toBeChecked()
    await expect(menu).toBeVisible()
  })
})
