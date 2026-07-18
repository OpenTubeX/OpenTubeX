import { test, expect, sel } from '../../helpers/app.mjs'

test.describe('app launch', () => {
  test('boots to a usable window', async ({ page }) => {
    await expect(page.locator('.topNav')).toBeVisible()
    await expect(page.locator('.sideNav')).toBeVisible()
    await expect(page.locator(sel.searchInput)).toBeVisible()
  })

  test('starts with a single active tab', async ({ page }) => {
    await expect(page.locator(sel.tabs)).toHaveCount(1)
    await expect(page.locator(sel.activeTab)).toHaveCount(1)
  })

  test('renderer produces no page errors during startup', async ({ app }) => {
    const errors = []
    app.page.on('pageerror', (error) => errors.push(error.message))
    // Give the app a moment to finish async startup work.
    await app.page.waitForTimeout(3000)
    expect(errors).toEqual([])
  })
})

test.describe('startup arguments', () => {
  test.use({ launchArgs: ['not-a-url.txt', '--unknown-option'] })

  test('ignores non-URL startup arguments', async ({ page }) => {
    await expect(page).toHaveURL(/#\/subscriptions/)
    await expect(page.locator(sel.tabs)).toHaveCount(1)
  })
})
