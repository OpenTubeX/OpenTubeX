import { hashPassword } from '../../../src/renderer/helpers/passwords.js'
import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'

const storedTestPassword = await hashPassword('test-settings-password')

test('requires matching password confirmation before protecting settings', async ({ page }, testInfo) => {
  const privacy = await goToSettingsSection(page, 'privacy')
  const password = privacy.getByLabel('Password', { exact: true })
  const confirmation = privacy.getByLabel('Confirm password', { exact: true })
  const save = privacy.getByRole('button', { name: /^Set password$/i })
  const storedPassword = () => page.evaluate(() => {
    return document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getSettingsPassword
  })

  await password.fill('test-settings-password')
  await expect(save).toBeDisabled()
  await password.press('Enter')
  await expect(confirmation).toBeFocused()
  await expect.poll(storedPassword).toBe('')

  await confirmation.fill('different-password')
  await expect(privacy.getByText('Passwords do not match.', { exact: true })).toBeVisible()
  expect(await confirmation.evaluate(element => getComputedStyle(element).outlineStyle), 'error border leaves the label notch clear').toBe('none')
  await expect(save).toBeDisabled()
  await confirmation.press('Enter')
  await expect.poll(storedPassword).toBe('')
  await confirmation.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('settings-password-confirmation.png') })

  await confirmation.fill('test-settings-password')
  await expect(privacy.getByText('Passwords do not match.', { exact: true })).toHaveCount(0)
  await expect(save).toBeEnabled()
  await confirmation.press('Enter')
  await expect.poll(storedPassword).toMatch(/^pbkdf2-sha256\$/)
  await privacy.getByRole('button', { name: /^Remove password$/i }).click()
  await expect(password).toHaveValue('')
  await expect(confirmation).toHaveValue('')
  await expect(save).toBeDisabled()
})

for (const width of [1600, 375]) {
  test.describe(`protected settings at ${width}px`, () => {
    test.use({ seed: { settings: { settingsPassword: storedTestPassword } } })

    for (const entry of ['All settings', 'Profile settings']) {
      test(`focuses the password input on opening and reopening through ${entry}`, async ({ app, page }) => {
        await app.electronApp.evaluate(({ BrowserWindow }, width) => {
          BrowserWindow.getAllWindows()[0].setContentSize(width, 900)
        }, width)
        for (let opening = 0; opening < 2; opening++) {
          if (entry === 'All settings') {
            await goTo(page, 'settings')
          } else {
            await page.locator('.profileTrigger').click()
            await page.locator('.quickSettingsMenu .profileSummary').click()
            await page.getByRole('button', { name: 'Profile', exact: true }).click()
            await expect(page.locator('.settingsWindow')).toBeVisible()
            await expect(page.locator('.quickSettingsMenu')).toBeHidden()
          }
          const password = page.locator('.settingsPassword').getByLabel('Password', { exact: true })
          await expect(password).toBeFocused()
          await page.keyboard.type('wrong-password')
          await page.keyboard.press('Enter')
          await expect(page.getByRole('alert')).toHaveText('Incorrect password')
          await page.keyboard.type('test-settings-password')
          await page.keyboard.press('Enter')
          await expect(page.locator('.settingsPassword')).toHaveCount(0)
          await page.locator('.settingsCloseButton').click()
          await expect(page.locator('.settingsWindow')).toBeHidden()
        }
      })
    }
  })
}
