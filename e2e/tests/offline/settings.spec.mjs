import { test, expect, sel, goTo } from '../../helpers/app.mjs'

test.describe('settings', () => {
  test('settings page renders its sections', async ({ page }) => {
    await goTo(page, 'settings')
    await expect(page).toHaveURL(/#\/settings/)
    await expect(page.locator('.settingsMenu, .ftSettingsMenu, [class*="settings"]').first()).toBeVisible()
  })

  test('a toggled setting persists across restarts', async ({ app }) => {
    let page = app.page
    await goTo(page, 'settings')

    const toggle = page.getByRole('checkbox', { name: 'Check for Updates' })
    await expect(toggle).not.toBeChecked()
    // The styled label covers the checkbox input, so click that instead.
    await page.locator('label.switch-label').filter({ hasText: 'Check for Updates' }).click()
    await expect(toggle).toBeChecked()
    // Give nedb a moment to flush the write.
    await page.waitForTimeout(1000)

    ;({ page } = await app.relaunch())
    await goTo(page, 'settings')
    await expect(page.getByRole('checkbox', { name: 'Check for Updates' })).toBeChecked()
  })
})
