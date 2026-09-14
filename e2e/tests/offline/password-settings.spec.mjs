import { test, expect, goTo } from '../../helpers/app.mjs'

test.describe('password protected settings', () => {
  test('settings lock behind a password until it is removed', async ({ app }) => {
    let page = app.page
    await goTo(page, 'settings')

    // Set a password. The settings page stays unlocked for this visit.
    await page.locator('.settingsMenu [data-section="privacy"]').click()
    await expect(page.locator('.settingsMenu [data-section="password"]')).toHaveCount(0)
    await page.getByPlaceholder('Password', { exact: true }).fill('hunter2')
    const setPasswordButton = page.getByRole('button', { name: /^Set password$/i })
    await expect(setPasswordButton.locator('[data-icon="key"]')).toBeVisible()
    await setPasswordButton.click()
    await page.waitForTimeout(1000)

    // After a restart the settings page asks for the password.
    ;({ page } = await app.relaunch())
    await goTo(page, 'settings')
    const passwordInput = page.getByPlaceholder('Password', { exact: true })
    const unlockButton = page.getByRole('button', { name: 'Unlock' })
    await expect(passwordInput).toBeVisible()
    await expect(unlockButton).toBeDisabled()
    await expect(page.getByRole('checkbox', { name: 'Check for Updates' })).toHaveCount(0)
    await expect(async () => {
      // Read related bounds in one frame during the page entrance animation.
      const gaps = await unlockButton.evaluate(button => {
        const pageBounds = document.querySelector('.settingsPage').getBoundingClientRect()
        const passwordBounds = document.querySelector('.settingsPassword').getBoundingClientRect()
        const cardBounds = document.querySelector('.settingsPassword .card').getBoundingClientRect()
        const unlockBounds = button.getBoundingClientRect()
        return {
          width: passwordBounds.width - pageBounds.width,
          left: passwordBounds.x - pageBounds.x,
          center: unlockBounds.x + unlockBounds.width / 2 - (cardBounds.x + cardBounds.width / 2)
        }
      })
      expect(gaps.width).toBeCloseTo(0, 0)
      expect(gaps.left).toBeCloseTo(0, 0)
      expect(gaps.center).toBeCloseTo(0, 0)
    }).toPass()

    // A wrong password keeps it locked.
    await passwordInput.fill('wrong')
    await passwordInput.press('Enter')
    await expect(passwordInput).toBeVisible()
    await expect(page.getByRole('alert')).toHaveText('Incorrect password')
    await expect(page.locator('.passwordInput')).toHaveClass(/invalid/)
    await expect(page.getByRole('checkbox', { name: 'Check for Updates' })).toHaveCount(0)

    // The correct password unlocks the sections.
    await passwordInput.fill('hunter2')
    await expect(unlockButton).toBeEnabled()
    await unlockButton.click()
    await expect(page.getByRole('checkbox', { name: 'Check for Updates' })).toBeVisible()

    // Removing the password unlocks settings permanently.
    await page.locator('.settingsMenu [data-section="privacy"]').click()
    const removePasswordButton = page.getByRole('button', { name: /^Remove password$/i })
    await expect(removePasswordButton.locator('[data-icon="trash"]')).toBeVisible()
    await removePasswordButton.click()
    await page.waitForTimeout(1000)
    ;({ page } = await app.relaunch())
    await goTo(page, 'settings')
    await expect(page.getByRole('checkbox', { name: 'Check for Updates' })).toBeVisible()
  })
})
