import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      baseTheme: 'system',
      systemDarkTheme: 'dark',
      systemLightTheme: 'light'
    }
  }
})

for (const scale of [1, 1.25]) {
  test(`yt-dlp fetching indicator stays centered at ${scale * 100}% UI scale`, async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('body')).toHaveClass(/\bdark\b/)
    await page.route('https://images.test/stream-poster.svg', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.route('https://images.test/tall-stream-poster.svg', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="568"><rect width="320" height="568" fill="#2563eb"/></svg>'
    }))
    await page.route('https://images.test/standard-stream-poster.svg', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#2563eb"/></svg>'
    }))
    await page.route('https://images.test/unavailable-stream-poster.svg', route => route.abort())
    await openMockedVideo(page)
    const watch = await watchViewHandle(page)
    await watch.evaluate(async view => {
      view.manifestSrc = null
      view.legacyFormats = []
      view.ytDlpStreamsPending = true
      view.thumbnail = 'https://images.test/stream-poster.svg'
      await view.$nextTick()
    })
    const placeholder = page.locator('.streamPlaceholder')
    await expect(placeholder).toBeVisible()
    await expectImagesLoaded(placeholder.locator('img'))
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setMinimumSize(0, 0)
      window.webContents.setZoomFactor(scale)
    }, scale)

    for (const size of [{ width: 375, height: 812 }, { width: 844, height: 390 }, { width: 1100, height: 800 }, { width: 1600, height: 900 }]) {
      await setWindowSize(app, page, size)
      await page.locator('.app').evaluate((element, width) => {
        element.classList.toggle('capacitorTabs', width < 1600)
        element.classList.toggle('capacitorPhoneLayout', width <= 844)
        element.classList.toggle('capacitorTabletLayout', width === 1100)
      }, size.width)
      for (const poster of ['stream-poster.svg', 'standard-stream-poster.svg', 'tall-stream-poster.svg', 'unavailable-stream-poster.svg', '']) {
        await watch.evaluate(async (view, poster) => {
          view.thumbnail = poster ? `https://images.test/${poster}` : ''
          await view.$nextTick()
        }, poster)
        if (poster && poster !== 'unavailable-stream-poster.svg') await expectImagesLoaded(placeholder.locator('img'))
        if (scale === 1 && size.width === 375 && poster === 'standard-stream-poster.svg') {
          await placeholder.screenshot({ path: testInfo.outputPath('phone-stream-placeholder.png') })
        }
        await expect.poll(() => placeholder.evaluate(element => {
          const player = element.getBoundingClientRect()
          const indicator = element.querySelector('.streamPlaceholderOverlay').getBoundingClientRect()
          return Math.max(
            Math.abs(indicator.x + indicator.width / 2 - player.x - player.width / 2),
            Math.abs(indicator.y + indicator.height / 2 - player.y - player.height / 2)
          ) * devicePixelRatio
        }), { message: `${size.width}x${size.height}, poster=${poster}` }).toBeLessThanOrEqual(1)
      }
    }
    await watch.dispose()
  })
}
