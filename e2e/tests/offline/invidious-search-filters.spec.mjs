import { test, expect, sel } from '../../helpers/app.mjs'

const INSTANCE_URL = 'https://invidious.test'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      defaultInvidiousInstance: INSTANCE_URL
    }
  }
})

test('sends the Invidious popularity sort parameter', async ({ page }) => {
  await page.route(`${INSTANCE_URL}/api/v1/search/**`, route => route.fulfill({ json: [] }))

  await page.locator('.navFilterButton').click()
  await page.locator('.searchRadio', { hasText: 'Prioritize' })
    .getByText('Popularity', { exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  const requestPromise = page.waitForRequest(request => {
    return request.url().startsWith(`${INSTANCE_URL}/api/v1/search/?`)
  })
  await page.locator(sel.searchInput).fill('linux')
  await page.locator(sel.searchInput).press('Enter')

  const requestUrl = new URL((await requestPromise).url())
  expect(requestUrl.searchParams.get('sort')).toBe('views')
  expect(requestUrl.searchParams.has('sort_by')).toBe(false)
})
