import { test, expect, goTo, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'
import { hashPassword } from '../../../src/renderer/helpers/passwords.js'

const password = 'test-settings-password'
const settingsPassword = await hashPassword(password)

for (const uiScale of [100, 125]) {
  test.describe(`protected settings subpage reopening at ${uiScale}%`, () => {
    test.use({ seed: { settings: { uiScale, settingsPassword } } })

    test('keeps Customize navigation and scroll after unlocking again', async ({ app, page }) => {
      await setWindowSize(app, page, uiScale === 125 ? { width: 500, height: 700 } : { width: 1100, height: 600 })
      await goTo(page, 'settings')
      const passwordInput = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      await expect(page.locator('.settingsPassword')).toHaveCount(0)
      const appearance = await goToSettingsSection(page, 'appearance')
      await appearance.getByRole('button', { name: 'Customize navigation', exact: true }).click()
      const subpage = page.locator('.selectedItem').first()
      await expect(subpage).toBeVisible()
      const scroller = page.locator('.settingsSubpageScroll:visible')
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      const scrollTop = await scroller.evaluate(element => element.scrollTop)
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await goTo(page, 'settings')
      await expect(passwordInput).toBeFocused()
      await expect(subpage).toBeHidden()
      await passwordInput.fill('wrong-password')
      await passwordInput.press('Enter')
      await expect(page.getByRole('alert')).toHaveText('Incorrect password')
      await expect(subpage).toBeHidden()
      await passwordInput.fill(password)
      await passwordInput.press('Enter')
      await expect(page.locator('.settingsPassword')).toHaveCount(0)
      await expect(page.locator('.settingsBreadcrumb')).toContainText('Customize navigation')
      await expect(page.locator('.selectedItem').last()).toBeVisible()
      await expect.poll(async () => Math.abs(await scroller.evaluate(element => element.scrollTop) - scrollTop))
        .toBeLessThanOrEqual(1)
    })
  })
}

for (const uiScale of [100, 125]) {
  test.describe(`settings subpage reopening at ${uiScale}%`, () => {
    test.use({ seed: { settings: { uiScale } } })

    for (const { section, label, title, content } of [
      { section: 'appearance', label: 'Customize navigation', content: '.selectedItem' },
      { section: 'appearance', label: 'Customize quick settings', content: '.selectedSection' },
      { section: 'appearance', label: 'Customize fullscreen actions', content: '.selectedAction' },
      { section: 'appearance', label: 'Create custom theme', title: 'Custom theme creator', content: '.customThemeEditor' },
      { section: 'playback', label: 'Manage Saved Channels', title: 'Saved Channel Settings', content: '.channelListContainer' },
    ]) {
      test(`keeps ${label} when settings is closed and reopened`, async ({ app, page }) => {
        if (uiScale === 125) await setWindowSize(app, page, { width: 500, height: 700 })
        const category = await goToSettingsSection(page, section)
        await category.getByRole('button', { name: label }).click()
        const breadcrumb = page.locator('.settingsBreadcrumb')
        const subpage = page.locator(content).first()
        await expect(breadcrumb).toContainText(title ?? label)
        await expect(subpage).toBeVisible()

        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt === 0) {
            await page.locator('.settingsCloseButton').click()
          } else {
            await app.electronApp.evaluate(({ BrowserWindow, Menu }) => {
              const window = BrowserWindow.getAllWindows()[0]
              const preferences = Menu.getApplicationMenu().items.find(item => item.label === 'File')
                .submenu.items.find(item => item.label === 'Preferences')
              preferences.click(undefined, window, undefined)
            })
          }
          await expect(page.locator('.settingsWindow')).toBeHidden()
          await goTo(page, 'settings')
          await expect(breadcrumb).toContainText(title ?? label)
          await expect(subpage).toBeVisible()
        }

        await page.getByRole('button', { name: 'Back', exact: true }).click()
        await expect(category).toBeVisible()
        await expect(subpage).toHaveCount(0)
        await page.locator('.settingsCloseButton').click()
        await expect(page.locator('.settingsWindow')).toBeHidden()
        await goTo(page, 'settings')
        await expect(category).toBeVisible()
        await expect(subpage).toHaveCount(0)

        if (uiScale === 125) await page.getByRole('button', { name: 'Back', exact: true }).click()
        await page.locator('.settingsMenu [data-section="privacy"]').click()
        await expect(page.locator('.settingsContent > [data-section="privacy"]')).toBeVisible()
      })
    }
  })
}
