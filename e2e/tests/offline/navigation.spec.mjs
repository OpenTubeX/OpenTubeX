import { test, expect, goTo, sel } from '../../helpers/app.mjs'

// Pages that work without any network access.
const OFFLINE_PAGES = [
  { route: 'subscriptions', name: 'Subscriptions' },
  { route: 'subscribedchannels', name: 'Channels' },
  { route: 'userplaylists', name: 'Playlists' },
  { route: 'history', name: 'History' },
  { route: 'settings', name: 'Settings' }
]

test.describe('side nav navigation', () => {
  for (const { route, name } of OFFLINE_PAGES) {
    test(`navigates to ${name}`, async ({ page }) => {
      await goTo(page, route)
    })
  }

  test('navigation history back and forward work', async ({ page }) => {
    await goTo(page, 'history')
    await goTo(page, 'settings')

    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/history/)

    await page.locator(sel.forwardButton).click()
    await expect(page).toHaveURL(/#\/settings/)
  })
})
