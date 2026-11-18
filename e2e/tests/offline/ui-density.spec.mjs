import { test, expect, goTo, goToSettingsSection, setWindowSize, chooseSelectOption } from '../../helpers/app.mjs'

test.use({ seed: { settings: { currentLocale: 'en-US' } } })

async function expectValidCategoryScrollbars(menu) {
  await expect.poll(() => menu.evaluate(element => {
    const lastCategory = element.querySelector('.titleItem:last-of-type')
    const renderedEnd = lastCategory.getBoundingClientRect().bottom - element.getBoundingClientRect().top +
      element.scrollTop + Number.parseFloat(getComputedStyle(element).paddingBottom)
    const maximum = Math.max(0, renderedEnd - element.clientHeight)
    if (element.scrollTop > maximum + 1 || Math.abs(element.scrollHeight - element.clientHeight - maximum) > 1) return false
    const scrollbar = element.querySelector('.os-scrollbar-vertical')
    if (maximum <= 1) return scrollbar.classList.contains('os-scrollbar-unusable')
    const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
    const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
    return !scrollbar.classList.contains('os-scrollbar-unusable') &&
      Math.abs(thumb.height / track.height - element.clientHeight / element.scrollHeight) < 0.02
  })).toBe(true)
}

/** @param {import('@playwright/test').Locator} appearance */
function densitySelect(appearance) {
  return appearance.locator('.select').filter({
    has: appearance.page().getByRole('combobox', { name: 'UI Density' })
  }).locator('select')
}

async function resizeWindowWidth(app, page, width) {
  const previousWidth = await page.evaluate(() => innerWidth)
  await app.electronApp.evaluate(({ BrowserWindow }, nextWidth) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setBounds({ ...window.getBounds(), width: nextWidth })
  }, width)
  await expect.poll(() => page.evaluate(() => innerWidth)).not.toBe(previousWidth)
}

for (const reveal of ['back', 'resize']) {
  test.describe(`hidden settings menu revealed by ${reveal}`, { tag: '@scale' }, () => {
    test('clamps the denser category menu when it becomes visible', async ({ app, page }) => {
      await setWindowSize(app, page, { width: 1500, height: 550 })
      const appearance = await goToSettingsSection(page, 'appearance')
      const menu = page.locator('.settingsMenu')
      await menu.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await resizeWindowWidth(app, page, 480)
      await expect(menu).toBeHidden()
      await chooseSelectOption(densitySelect(appearance), 'compact')
      await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-density'))).toBe('0.5')
      if (reveal === 'back') {
        await page.locator('.settingsBackButton').click()
      } else {
        await resizeWindowWidth(app, page, 1500)
      }
      await expect(menu).toBeVisible()
      await expectValidCategoryScrollbars(menu)
    })
  })
}

for (const width of [480, 1500]) {
  test.describe(`UI density at ${width}px`, { tag: '@scale' }, () => {
    test('preserves category navigation and valid scrollbars after compacting categories at the bottom', async ({ app, page }) => {
      await setWindowSize(app, page, { width, height: 650 })
      // Slow the opening transition to exercise measurement during animation.
      await page.addStyleTag({ content: '.settingsWindow.settings-window-enter-active { transition-duration: 2s !important; }' })
      await goTo(page, 'settings')
      const menu = page.locator('.settingsMenu')
      await expect(menu).toBeVisible()
      await expect(page.locator('.settingsWindow')).toHaveCSS('transform', 'none')
      const category = menu.locator('.titleItem').first()
      const defaultHeight = await category.evaluate(element => element.getBoundingClientRect().height)
      await menu.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

      // The control lives on another view in compact layouts. Change the same
      // preference directly to exercise shortening the currently visible menu.
      await page.evaluate(() => window.$store.dispatch('updateUiDensity', 'compact'))
      await expect.poll(() => category.evaluate(element => element.getBoundingClientRect().height))
        .toBeLessThan(defaultHeight - 3)
      await expectValidCategoryScrollbars(menu)

      const appearance = await goToSettingsSection(page, 'appearance')
      await chooseSelectOption(densitySelect(appearance), 'default')
      if (width === 480) await page.locator('.settingsBackButton').click()
      await expect(menu).toBeVisible()
      await expect.poll(() => category.evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(defaultHeight, 0)
    })
  })
}
