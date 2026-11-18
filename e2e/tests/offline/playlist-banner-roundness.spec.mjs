import { test, expect, goTo } from '../../helpers/app.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const videos = Array.from({ length: 6 }, (_, index) => ({
  videoId: `layout0000${index}`,
  playlistItemId: `rounded-${index}`,
  title: `Mountain walks ${index + 1}`,
  author: 'Test channel',
  lengthSeconds: 120,
  type: 'video'
}))

async function openPlaylist(page) {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.route('https://invidious.test/vi/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await goTo(page, 'userplaylists')
  await page.getByRole('link', { name: 'Mountain walks', exact: true }).click()
  await expect(page.locator('.playlistItemsCard .videoThumbnail').first()).toBeVisible()
}

async function updateSetting(page, action, value) {
  await page.evaluate(({ action, value }) => window.$store.dispatch(action, value), { action, value })
}

async function resize(app, page, width, uiScale) {
  await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(Math.round(width * uiScale / 100), Math.round(900 * uiScale / 100))
  }, { width, uiScale })
  await expect.poll(() => page.evaluate(width => Math.abs(innerWidth - width), width)).toBeLessThanOrEqual(1)
}

test.describe('playlist spacing and corners', { tag: '@scale' }, () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'system',
        systemDarkTheme: 'dark',
        systemLightTheme: 'light',
        playlistViewType: 'grid',
        listType: 'grid',
        backendPreference: 'invidious',
        backendFallback: false,
        enableSearchSuggestions: false,
        defaultInvidiousInstance: 'https://invidious.test'
      },
      playlists: [{
        _id: 'rounded-playlist',
        playlistName: 'Mountain walks',
        protected: false,
        description: '',
        videos,
        lastUpdatedAt: 1700000000000
      }]
    }
  })

  test('blurred playlist thumbnails stay inside their rounded frame', async ({ app, page, uiScale }, testInfo) => {
    await openPlaylist(page)
    await updateSetting(page, 'updatePlaylistViewType', 'list')
    await resize(app, page, 1440, uiScale)
    const frame = page.locator('.playlistInfo .playlistThumbnail')
    const image = frame.locator('img')
    await expectImagesLoaded(image)
    // Electron's screenshot clips use coordinates before its UI zoom is applied.
    const screenshotScale = uiScale / 100
    for (const roundness of [100, 0]) {
      await updateSetting(page, 'updateUiRoundness', roundness)
      await updateSetting(page, 'updateBlurThumbnails', false)
      const box = await image.boundingBox()
      const outsideFrame = {
        x: (box.x + box.width + 2) * screenshotScale,
        y: (box.y + box.height / 2) * screenshotScale,
        width: 4 * screenshotScale,
        height: 4 * screenshotScale
      }
      const background = await page.screenshot({ clip: outsideFrame, animations: 'disabled', scale: 'css' })
      await updateSetting(page, 'updateBlurThumbnails', true)
      await expect(image).toHaveCSS('filter', 'blur(20px)')
      const blurredBackground = await page.screenshot({ clip: outsideFrame, animations: 'disabled', scale: 'css' })
      expect(blurredBackground, `roundness ${roundness}: blur must not paint outside the frame`).toEqual(background)
      await expect(frame).toHaveCSS('border-radius', `${8 * roundness / 100}px`, { timeout: 1000 })
      const frameBox = await frame.boundingBox()
      expect(frameBox.height).toBeCloseTo(box.height, 0)
    }
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
      const box = await frame.boundingBox()
      await page.screenshot({
        path: testInfo.outputPath(`rounded-blurred-playlist-${colorScheme}.png`),
        clip: { x: (box.x - 8) * screenshotScale, y: (box.y - 8) * screenshotScale, width: (box.width + 16) * screenshotScale, height: (box.height + 16) * screenshotScale }
      })
    }
  })
})
