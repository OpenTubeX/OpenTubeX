import { test, expect } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      generalAutoLoadMorePaginatedItemsEnabled: true
    }
  }
})

test('stops showing the auto-load spinner when a hashtag has no more videos', async ({ page }) => {
  await page.route('**/api/v1/hashtag/**', async (route) => {
    await route.fulfill({ json: { results: [] } })
  })

  const hashtagTab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/hashtag/pagination-test',
    makeActive: false
  }))
  await page.locator(`.tab[data-tab-id="${hashtagTab.id}"]`).click()

  await expect(page).toHaveURL(/#\/hashtag\/pagination-test/)
  await expect(page.getByText('This hashtag does not currently have any videos')).toBeVisible()
  await expect(page.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
})

test('does not offer to fetch more after the initial hashtag request fails', async ({ page }) => {
  await page.route('**/api/v1/hashtag/**', async (route) => {
    await route.fulfill({ status: 500, json: { error: 'test failure' } })
  })
  const failedResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/hashtag/') && response.status() === 500
  )

  const hashtagTab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/hashtag/request-failure',
    makeActive: false
  }))
  await page.locator(`.tab[data-tab-id="${hashtagTab.id}"]`).click()

  await expect(page).toHaveURL(/#\/hashtag\/request-failure/)
  await failedResponse
  await expect(page.getByText('This hashtag does not currently have any videos')).toBeVisible()
  await expect(page.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
})
