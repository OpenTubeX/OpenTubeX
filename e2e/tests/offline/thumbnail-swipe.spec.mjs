import path from 'node:path'
import { copyFile, mkdir, unlink } from 'node:fs/promises'
import { test, expect, goTo, goToSettingsSection, repoRoot } from '../../helpers/app.mjs'
import { SWIPE_VIDEO, verifyThumbnailSwipes, verifyPlaylistSwipeRemoval, verifyCopySwipe, verifySwipeDownloadAvailability, verifyReverseSwipes, swipeAction } from '../../helpers/thumbnail-swipe.mjs'

test.use({ seed: { history: [SWIPE_VIDEO] } })

test('download swipe settings stay readable when downloads are disabled', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await goToSettingsSection(page, 'general')
  await verifySwipeDownloadAvailability(page)
})

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
        await page.evaluate(() => window.$store.commit('setListType', 'list'))
        await page.evaluate(() => window.$store.dispatch('updateReducedMotion', 'on'))
        await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'reduce')
        await verifyThumbnailSwipes(page, session, attachScreenshot)
        await page.setViewportSize({ width: 375, height: 812 })
        await page.evaluate(() => window.$store.dispatch('updateUiScale', 125))
        await verifyThumbnailSwipes(page, session, attachScreenshot)
        await page.evaluate(() => window.$store.dispatch('updateUiScale', 100))
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

for (const surface of ['history', 'downloads']) {
  test.describe(`reverse swipe on ${surface}`, () => {
    const destination = path.join(repoRoot, 'e2e/fixtures/media/demo.webm')
    test.use({
      seed: {
        settings: { enableDownloads: true },
        history: [SWIPE_VIDEO],
        downloads: [{
          id: 2242,
          videoId: SWIPE_VIDEO.videoId,
          title: SWIPE_VIDEO.title,
          status: 'completed',
          mode: 'video',
          destination,
          destinations: [destination],
          files: [{ videoId: SWIPE_VIDEO.videoId, path: destination, duration: 60, extension: 'webm' }],
        }],
      }
    })
    test('toggles queue and watched actions and offers download removal @scale', async ({ page, attachScreenshot }) => {
      await page.setViewportSize({ width: 480, height: 900 })
      await goTo(page, surface)
      const session = await page.context().newCDPSession(page)
      try {
        await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
        const target = page.locator(surface === 'history' ? '.ft-list-video .title' : '.downloadRow h3').first()
        await page.evaluate(() => window.$store.commit('setThumbnailLeftSwipeAction', 'download'))
        await swipeAction(page, session, target, 'Remove File', attachScreenshot)
        await expect(page.getByRole('dialog', { name: 'Remove downloaded file?', exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await verifyReverseSwipes(page, session, target, attachScreenshot)
      } finally { await session.detach() }
    })
  })
}

test.describe('stale swipe download removal', () => {
  test.use({
    // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
    seed: async ({}, use, testInfo) => {
      const destination = testInfo.outputPath('download.webm')
      await mkdir(path.dirname(destination), { recursive: true })
      await copyFile(path.join(repoRoot, 'e2e/fixtures/media/demo.webm'), destination)
      await use({
        settings: { enableDownloads: true },
        history: [SWIPE_VIDEO],
        downloads: [{
          id: 2242,
          videoId: SWIPE_VIDEO.videoId,
          title: SWIPE_VIDEO.title,
          status: 'completed',
          mode: 'video',
          destination,
          destinations: [destination],
          files: [{ videoId: SWIPE_VIDEO.videoId, path: destination, duration: 60, extension: 'webm' }],
        }],
      })
    },
  })
  test('refreshes a missing file after removal fails and offers downloading again', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 480, height: 900 })
    await goTo(page, 'history')
    await page.evaluate(() => window.$store.commit('setThumbnailLeftSwipeAction', 'download'))
    await expect.poll(() => page.evaluate(() => window.$store.getters.getYtDlpDownloads[2242]?.availability)).toBe('available')
    await unlink(testInfo.outputPath('download.webm'))
    const session = await page.context().newCDPSession(page)
    try {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      const target = page.locator('.ft-list-video .title').first()
      await swipeAction(page, session, target, 'Remove File')
      await page.getByRole('button', { name: 'Remove File', exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.$store.getters.getYtDlpDownloads[2242]?.availability)).toBe('missing')
      await swipeAction(page, session, target, 'Download Video')
      await expect(page.getByRole('dialog', { name: SWIPE_VIDEO.title, exact: true })).toBeVisible()
    } finally { await session.detach() }
  })
})
