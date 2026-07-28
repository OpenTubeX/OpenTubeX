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

  test('navigation history popout shows page icons and a drop shadow', async ({ page }) => {
    await goTo(page, 'history')
    await goTo(page, 'settings')

    await page.locator(sel.backButton).click({ button: 'right' })

    const popout = page.locator('.topNav .iconDropdown')
    await expect(popout).toBeVisible()
    await expect(popout.locator('[role="option"]')).toHaveCount(3)
    await expect(popout.locator('[role="option"] svg')).toHaveCount(3)
    await expect(popout).not.toHaveCSS('box-shadow', 'none')
  })
})

test.describe('navigation history titles', () => {
  test.use({
    seed: {
      history: [{
        _id: 'jNQXAC9IVRw',
        videoId: 'jNQXAC9IVRw',
        title: 'Me at the zoo',
        author: 'jawed',
        authorId: 'UC4QobU6STFB0P71PMvOGN5A',
        published: 0,
        lengthSeconds: 19,
        watchProgress: 0,
        timeWatched: Date.now(),
        isWatched: false,
        type: 'video'
      }]
    }
  })

  test('keeps a known video title when navigating away before it loads', async ({ page }) => {
    await goTo(page, 'history')
    await page.locator('.ft-list-video .title').click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/history/)
    await page.locator(sel.forwardButton).click({ button: 'right' })

    const options = page.locator('.topNav .iconDropdown [role="option"]')
    await expect(options.filter({ hasText: 'Me at the zoo' })).toHaveCount(1)
    await expect(options.filter({ hasText: '/watch/jNQXAC9IVRw' })).toHaveCount(0)
  })
})
