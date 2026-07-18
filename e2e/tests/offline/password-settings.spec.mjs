import { test, expect, goTo } from '../../helpers/app.mjs'

test.describe('password protected settings', () => {
  test('settings lock behind a password until it is removed', async ({ app }) => {
    let page = app.page
    await goTo(page, 'settings')

    // Set a password. The settings page stays unlocked for this visit.
    await page.getByPlaceholder('Set a password to prevent access to settings').fill('hunter2')
    await page.getByRole('button', { name: 'Set Password', exact: true }).click()
    await page.waitForTimeout(1000)

    // After a restart the settings page asks for the password.
    ;({ page } = await app.relaunch())
    await goTo(page, 'settings')
    const passwordInput = page.getByPlaceholder('Password', { exact: true })
    await expect(passwordInput).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Check for Updates' })).toHaveCount(0)

    // A wrong password keeps it locked.
    await passwordInput.fill('wrong')
    await passwordInput.press('Enter')
    await expect(passwordInput).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Check for Updates' })).toHaveCount(0)

    // The correct password unlocks the sections.
    await passwordInput.fill('hunter2')
    await passwordInput.press('Enter')
    await expect(page.getByRole('checkbox', { name: 'Check for Updates' })).toBeVisible()

    // Removing the password unlocks settings permanently.
    await page.getByRole('button', { name: 'Remove Password' }).click()
    await page.waitForTimeout(1000)
    ;({ page } = await app.relaunch())
    await goTo(page, 'settings')
    await expect(page.getByRole('checkbox', { name: 'Check for Updates' })).toBeVisible()
  })
})
