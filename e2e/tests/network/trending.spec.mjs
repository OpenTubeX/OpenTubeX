import { goTo } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'

test.describe('trending page', () => {
  test('shows trending videos and switches categories', async ({ page }) => {
    await goTo(page, 'trending')

    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })

    const sportsTab = page.getByRole('tab', { name: 'Sports' })
    await sportsTab.click()
    await expect(sportsTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })

    const gamingTab = page.getByRole('tab', { name: 'Gaming' })
    await gamingTab.click()

    const resultTransitions = await page.locator('#trendingPanel .autoGrid').evaluate((grid) => {
      return Array.from(grid.children, (result) => result.classList.contains('feed-enter-active'))
    })
    expect(resultTransitions.length).toBeGreaterThan(0)
    expect(resultTransitions.every(Boolean)).toBe(true)

    await expect(gamingTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })
  })
})
