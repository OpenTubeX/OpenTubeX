import { test, expect, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'

for (const { uiScale, width, iconPack, colorScheme } of [
  { uiScale: 100, width: 1100, iconPack: 'material', colorScheme: 'dark' },
  { uiScale: 125, width: 420, iconPack: 'remix', colorScheme: 'light' },
]) {
  test.describe(`customizer actions at ${uiScale}% scale`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          iconPack,
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue',
        }
      }
    })

    for (const { subpage, label, rowSelector } of [
      { subpage: 'quick-settings', label: 'Customize quick settings', rowSelector: '.selectedSetting' },
      { subpage: 'navigation', label: 'Customize navigation', rowSelector: '.selectedItem' },
      { subpage: 'fullscreen-actions', label: 'Customize fullscreen actions', rowSelector: '.selectedAction' },
    ]) {
      test(`keeps ${subpage} hover and focus backgrounds circular`, async ({ app, page }) => {
        await setWindowSize(app, page, { width, height: 800 })
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
        const appearance = await goToSettingsSection(page, 'appearance')
        await appearance.getByRole('button', { name: label, exact: true }).click()
        const row = page.locator(rowSelector).nth(1)
        const buttons = row.locator('.iconButton')
        await expect(buttons).toHaveCount(3)
        for (const button of await buttons.all()) {
          await button.hover()
          await expect.poll(() => button.evaluate(element => {
            const { width, height } = element.getBoundingClientRect()
            return Math.abs(width - height)
          }), 'Circular action buttons have equal width and height').toBeLessThanOrEqual(0.1)
          await expect(button).toHaveCSS('border-radius', '50%')
          await expect.poll(() => button.evaluate(element => (
            getComputedStyle(element).backgroundColor !==
            getComputedStyle(element.closest('li')).backgroundColor
          ))).toBe(true)
        }
        const remove = buttons.last()
        await page.mouse.move(0, 0)
        await remove.focus()
        await remove.press('Tab')
        await page.keyboard.press('Shift+Tab')
        await expect(remove).toBeFocused()
        await expect.poll(() => remove.evaluate(element => element.matches(':focus-visible'))).toBe(true)
        await expect.poll(() => remove.evaluate(element => (
          getComputedStyle(element).backgroundColor !==
          getComputedStyle(element.closest('li')).backgroundColor
        ))).toBe(true)
      })
    }
  })
}
