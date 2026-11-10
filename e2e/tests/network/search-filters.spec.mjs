import { sel } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'

test.describe('search filters', () => {
  test('filtering by type returns channel results', async ({ page }) => {
    await page.locator(sel.searchInput).fill('blender')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('.navFilterButton').click()
    await page.locator('.searchRadio', { hasText: 'Type' }).getByText('Channels', { exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    // Filters apply to the next submitted search.
    await page.locator(sel.searchInput).fill('blender')
    await page.locator(sel.searchInput).press('Enter')

    await expect(page.locator('.ft-list-channel').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.ft-list-video')).toHaveCount(0)
  })
})
