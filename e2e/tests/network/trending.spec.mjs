import { goTo } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'

test.describe('trending page', () => {
  test('shows trending videos and switches categories', async ({ page }) => {
    await goTo(page, 'trending')

    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })

    const gamingTab = page.getByRole('tab', { name: 'Gaming' })
    await gamingTab.click()
    await expect(gamingTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })
  })
})
