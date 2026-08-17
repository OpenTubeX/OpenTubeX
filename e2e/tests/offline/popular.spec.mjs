import { test, expect, goTo } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      defaultInvidiousInstance: 'https://invidious.test'
    }
  }
})

test('shows an explicit status for an empty Popular feed', async ({ page }) => {
  await page.route('https://invidious.test/api/v1/popular/**', route => route.fulfill({ json: [] }))

  await goTo(page, 'popular')

  await expect(page.locator('.emptyMessage')).toHaveText("This Invidious instance's Most Popular feed is empty.")
  await expect(page.locator('.toast', { hasText: 'Invidious API Error' })).toHaveCount(0)

  await page.unrouteAll()
  await page.route('https://invidious.test/api/v1/popular/**', route => route.fulfill({
    json: { error: 'Popular feed unavailable' }
  }))
  await page.locator('.headerRefreshWidget .refreshButton').click()

  await expect(page.locator('.toast', { hasText: 'Invidious API Error' })).toBeVisible()
  await expect(page.locator('.emptyMessage')).toHaveCount(0)
})

test('does not present a failed Popular request as an empty feed', async ({ page }) => {
  await page.route('https://invidious.test/api/v1/popular/**', route => route.fulfill({
    json: { error: 'Popular feed unavailable' }
  }))

  await goTo(page, 'popular')

  await expect(page.locator('.toast', { hasText: 'Invidious API Error' })).toBeVisible()
  await expect(page.locator('.emptyMessage')).toHaveCount(0)
})
