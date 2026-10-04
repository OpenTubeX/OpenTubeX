import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'
import { SWIPE_VIDEO, verifyThumbnailSwipes, verifyPlaylistSwipeRemoval, verifyCopySwipe } from '../../helpers/thumbnail-swipe.mjs'

test.use({ seed: { history: [SWIPE_VIDEO] } })

for (const iconPack of ['material', 'remix']) {
  test.describe(`thumbnail swipe gestures with ${iconPack} icons`, () => {
    test.use({ seed: { history: [SWIPE_VIDEO], settings: { currentLocale: 'en-US', iconPack, baseTheme: iconPack === 'material' ? 'dark' : 'light' } } })
    test('touch shortcuts preserve navigation, scrolling, and long press menus', async ({ page, attachScreenshot }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      await goTo(page, 'history')
      const session = await page.context().newCDPSession(page)
      try {
        await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
        await verifyThumbnailSwipes(page, session, attachScreenshot)
        await page.setViewportSize({ width: 812, height: 375 })
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setListType', 'list'))
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateReducedMotion', 'on'))
        await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'reduce')
        await verifyThumbnailSwipes(page, session, attachScreenshot)
        await page.setViewportSize({ width: 375, height: 812 })
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', 125))
        await verifyThumbnailSwipes(page, session, attachScreenshot)
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', 100))
        await goToSettingsSection(page, 'general')
        const left = page.getByRole('combobox', { name: 'Swipe left on thumbnails', exact: true })
        const right = page.getByRole('combobox', { name: 'Swipe right on thumbnails', exact: true })
        await expect(left).toBeVisible()
        await expect(right).toBeVisible()
        await left.click()
        await page.getByRole('option', { name: 'Mark As Watched', exact: true }).click()
        await right.click()
        await page.getByRole('option', { name: 'Disabled', exact: true }).click()
        await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
        await expect(page.locator('.settingsWindow')).toHaveCount(0)
        const thumbnail = page.locator('.ft-list-video .videoThumbnail').first()
        const title = page.locator('.ft-list-video .title').first()
        await title.scrollIntoViewIfNeeded()
        const rect = await title.boundingBox()
        const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x - 40 }] })
        const feedback = page.locator('.thumbnailSwipeFeedback')
        await expect(feedback).toBeVisible()
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x - 100 }] })
        await expect(feedback).toHaveClass(/thumbnailSwipeReady/)
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(thumbnail.locator('.videoWatched')).toBeVisible()
        await expect(page).toHaveURL(/#\/history/)
        await goTo(page, 'settings')
        await expect(left.locator('..').locator('select')).toHaveValue('history')
        await expect(right.locator('..').locator('select')).toHaveValue('disabled')
        await attachScreenshot(`thumbnail swipe settings ${iconPack}`)
        await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
        await expect(page.locator('.settingsWindow')).toHaveCount(0)
        await verifyPlaylistSwipeRemoval(page, session, attachScreenshot)
      } finally { await session.detach() }
    })
  })
}

for (const context of ['Invidious sharing', 'public playlist']) {
  test.describe(`copy swipe with ${context}`, () => {
    const publicPlaylist = context === 'public playlist'
    test.use({
      seed: {
        settings: { currentLocale: 'en-US', backendFallback: !publicPlaylist, saveVideoHistoryWithLastViewedPlaylist: true },
        history: [{ ...SWIPE_VIDEO, ...(publicPlaylist ? { lastViewedPlaylistId: 'PLswipe-test', lastViewedPlaylistType: 'youtube' } : {}) }],
      }
    })
    test('copies the mapped submenu action without opening the menu or navigating', async ({ page, app }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      await goTo(page, 'history')
      const session = await page.context().newCDPSession(page)
      try {
        await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
        await verifyCopySwipe(page, session, () => app.electronApp.evaluate(({ clipboard }) => clipboard.readText()),
          `https://youtu.be/${SWIPE_VIDEO.videoId}${publicPlaylist ? '?list=PLswipe-test' : ''}`)
        await expect(page.locator('.mobileLinkActions')).toHaveCount(0)
      } finally { await session.detach() }
    })
  })
}
