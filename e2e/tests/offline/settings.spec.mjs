import { test, expect, goTo } from '../../helpers/app.mjs'

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

test.describe('synced setting indicators', () => {
  test.use({
    seed: {
      settings: {
        syncServerAutoSync: false,
        syncServerSyncSettings: true,
        syncServerToken: 'e2e-sync-token'
      }
    }
  })

  test('allows account sync to be disabled per setting', async ({ page }) => {
    await goTo(page, 'settings')

    const syncedLabel = page.locator('label').filter({ hasText: 'Default Landing Page' })
    const syncButton = syncedLabel.getByRole('button', { name: 'Stop syncing this setting' })
    await expect(syncButton).toBeVisible()
    await syncButton.click()
    await expect(syncedLabel.getByRole('button', { name: 'Sync this setting' })).toBeVisible()

    await page.reload()
    await expect(syncedLabel.getByRole('button', { name: 'Sync this setting' })).toBeVisible()

    const toggle = page.getByRole('checkbox', { name: /Auto load next page/i })
    await page.locator('label').filter({ hasText: 'Auto load next page' })
      .getByRole('button', { name: 'Stop syncing this setting' })
      .click()
    await expect(toggle).not.toBeChecked()

    const localOnlyLabel = page.locator('label').filter({ hasText: 'Check for Updates' })
    await expect(localOnlyLabel.getByRole('button', { name: /syncing this setting/i })).toHaveCount(0)
  })
})
