import { test, expect, sel } from '../../helpers/app.mjs'

test.describe('startup arguments', () => {
  test.use({ launchArgs: ['not-a-url.txt', '--unknown-option'] })

  test('ignores non-URL startup arguments', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))

    await expect(page).toHaveURL(/#\/subscriptions/)
    await expect(page.locator('.topNav')).toBeVisible()
    await expect(page.locator('.sideNav')).toBeVisible()
    await expect(page.locator(sel.searchInput)).toBeVisible()
    await expect(page.locator(sel.tabs)).toHaveCount(1)
    await expect(page.locator(sel.activeTab)).toHaveCount(1)

    // Keep coverage for async startup work that finishes after readiness.
    await page.waitForTimeout(3000)
    expect(errors).toEqual([])
  })
})
