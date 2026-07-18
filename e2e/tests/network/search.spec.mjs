import { sel } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'

test.describe('search', () => {
  test('search returns video results', async ({ page }) => {
    await page.locator(sel.searchInput).fill('big buck bunny')
    await page.locator(sel.searchInput).press('Enter')

    await expect(page).toHaveURL(/#\/search\//)
    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })
    expect(await page.locator('.ft-list-video').count()).toBeGreaterThan(3)
  })

  test('opening a search result loads the watch page', async ({ page, innertube }) => {
    await page.locator(sel.searchInput).fill('big buck bunny')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('.ft-list-video .title').first().click()
    await expect(page).toHaveURL(/#\/watch\//)
    if (!innertube.replay) {
      // Full watch page hydration needs the real API.
      await expect(page.locator('.videoTitle')).toBeVisible({ timeout: 30_000 })
    }
  })
})
