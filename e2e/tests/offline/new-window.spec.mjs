import { test, expect, waitForAppReady } from '../../helpers/app.mjs'

test('the new window button opens a second working window', async ({ app, page }) => {
  const [newWindow] = await Promise.all([
    app.electronApp.waitForEvent('window'),
    page.locator('.topNav .navNewWindowButton').click()
  ])

  await waitForAppReady(newWindow)

  // Both windows stay usable and navigate independently.
  await newWindow.locator('.sideNav a[href="#/history"]:visible').first().click()
  await expect(newWindow).toHaveURL(/#\/history/)
  await expect(page).not.toHaveURL(/#\/history/)
})
