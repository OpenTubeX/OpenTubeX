import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo, repoRoot, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const thumbnail = `data:image/svg+xml;base64,${(await readFile(path.join(repoRoot, 'e2e/fixtures/media/video-thumbnail.svg'))).toString('base64')}`
const downloads = [1, 2, 3].map(id => ({
  id,
  videoId: id === 2 ? '' : `offline000${id}`,
  ...(id === 2 ? { retryPayload: { externalUrl: 'https://example.com/video' } } : {}),
  title: `Saved audio ${id}`,
  author: 'Offline channel',
  status: 'completed',
  mode: 'audio',
  thumbnail: id === 3 ? '' : thumbnail,
  files: [{ videoId: `offline000${id}`, ...(id === 2 ? { title: 'Saved audio 2' } : {}), path: path.join(repoRoot, 'e2e/fixtures/media/demo-audio.mp3'), extension: 'mp3' }],
}))

for (const width of [1500, 480]) {
  test.describe(`offline recommendations at ${width}px`, () => {
    test.use({
      seed: {
        settings: { landingPage: 'history', enableDownloads: true, autoplayVideos: true, videoPlaybackEngine: 'built-in', uiScale: width === 480 ? 125 : 100 },
        downloads,
      }
    })

    test('shows saved thumbnails while playing a download offline', async ({ app, page }) => {
      await setWindowSize(app, page, { width, height: 850 })
      await page.context().route(/^https?:/, route => route.abort('internetdisconnected'))
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
        window.dispatchEvent(new Event('offline'))
      })
      if (width === 480) {
        await page.getByRole('button', { name: 'Quick settings', exact: true }).click()
        await page.getByRole('button', { name: 'Downloads', exact: true }).click()
      } else {
        await goTo(page, 'downloads')
      }
      await page.locator('.downloadRow').filter({ has: page.getByRole('heading', { name: 'Saved audio 1', exact: true }) }).getByRole('button', { name: 'Play download', exact: true }).click()
      const recommendations = page.locator('.watchVideoRecommendations')
      await expect(recommendations.getByRole('heading', { name: 'Available offline', exact: true })).toBeVisible()
      const saved = recommendations.getByRole('link', { name: 'Saved audio 2 Offline channel', exact: true })
      await expect(saved.locator('img')).toHaveAttribute('src', thumbnail)
      await expect.poll(() => saved.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
      const fallback = recommendations.getByRole('link', { name: 'Saved audio 3 Offline channel', exact: true }).locator('img')
      await expect.poll(() => fallback.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
      await expect(recommendations.getByRole('link', { name: 'Saved audio 1 Offline channel', exact: true })).toHaveCount(0)
      await saved.click()
      await expect(page).toHaveURL(/#\/watch\/offline0002\?downloadId=2/)
      await expect.poll(() => page.locator('video').first().evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2)
    })

    test('replaces loaded Up Next with saved downloads on disconnect and restores it on reconnect', async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await page.locator('video.player').evaluate(video => video.pause())
      await setWindowSize(app, page, { width, height: 850 })
      const recommendations = page.locator('.watchVideoRecommendations')
      await expect(recommendations.getByRole('heading', { name: 'Up Next', exact: true })).toBeVisible()
      const originalTitles = await recommendations.locator('.h3Title').allTextContents()
      expect(originalTitles.length).toBeGreaterThan(0)
      const watch = await watchViewHandle(page)
      try {
        expect(await watch.evaluate(vm => vm.localFilePlayback)).toBe(false)
        await page.evaluate(() => {
          Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
          window.dispatchEvent(new Event('offline'))
        })
        await expect(recommendations.getByRole('heading', { name: 'Available offline', exact: true })).toBeVisible()
        await expect(recommendations.locator('.offlineDownloadTitle')).toHaveText(['Saved audio 3', 'Saved audio 2', 'Saved audio 1'])
        await expect(recommendations.locator('.h3Title')).toHaveCount(0)
        await expect(recommendations.getByRole('link', { name: 'Saved audio 2 Offline channel', exact: true }).locator('img')).toHaveAttribute('src', thumbnail)
        expect(await watch.evaluate(vm => vm.fullscreenRecommendationsAvailable)).toBe(true)
        await recommendations.scrollIntoViewIfNeeded()
        await recommendations.screenshot({ path: testInfo.outputPath('available-offline.png') })
        await page.evaluate(() => {
          const store = window.$store
          for (const id of [1, 2, 3]) store.commit('removeYtDlpDownload', id)
        })
        await expect(recommendations).toHaveCount(0)
        expect(await watch.evaluate(vm => vm.fullscreenRecommendationsAvailable)).toBe(false)
        await page.evaluate(() => {
          Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
          window.dispatchEvent(new Event('online'))
        })
        await expect(recommendations.getByRole('heading', { name: 'Up Next', exact: true })).toBeVisible()
        await expect(recommendations.locator('.h3Title')).toHaveText(originalTitles)
        await expect(recommendations.locator('.offlineDownloadRecommendation')).toHaveCount(0)
      } finally {
        await watch.dispose()
      }
    })
  })
}

for (const dataSaver of [false, true]) {
  test.describe(`offline thumbnail URLs with data saver ${dataSaver ? 'enabled' : 'disabled'}`, () => {
    const storedUrl = 'https://i.ytimg.com/vi/offline0002/hqdefault.jpg'
    const cachedUrl = `https://i.ytimg.com/vi/offline0002/${dataSaver ? 'mq' : 'maxres'}default.jpg`
    test.use({
      seed: {
        settings: { landingPage: 'history', enableDownloads: true, thumbnailDataSaver: dataSaver },
        downloads: downloads.map(download => download.id === 2 ? { ...download, thumbnail: storedUrl } : download),
      }
    })
    test('requests the same thumbnail as Downloads after disconnecting', async ({ page }) => {
      await page.route(/^https?:/, route => route.request().url() === cachedUrl
        ? fulfillVisualFixture(route, 'video-thumbnail')
        : route.abort('internetdisconnected'))
      await goTo(page, 'downloads')
      const savedRow = page.locator('.downloadRow').filter({ has: page.getByRole('heading', { name: 'Saved audio 2', exact: true }) })
      await expectImagesLoaded(savedRow.locator('.downloadThumbnail'))
      await expect(savedRow.locator('.downloadThumbnail')).toHaveAttribute('src', cachedUrl)
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
        window.dispatchEvent(new Event('offline'))
      })
      await page.locator('.downloadRow').filter({ has: page.getByRole('heading', { name: 'Saved audio 1', exact: true }) }).getByRole('button', { name: 'Play download', exact: true }).click()
      const saved = page.locator('.offlineDownloadRecommendation').filter({ hasText: 'Saved audio 2' })
      await expectImagesLoaded(saved.locator('img'))
      await expect(saved.locator('img')).toHaveAttribute('src', cachedUrl)
    })
  })
}

for (const preference of ['hidden', 'blur']) {
  test.describe(`offline ${preference} thumbnails`, () => {
    test.use({
      seed: {
        settings: { landingPage: 'history', enableDownloads: true, videoPlaybackEngine: 'built-in', thumbnailPreference: preference === 'hidden' ? 'hidden' : '', blurThumbnails: preference === 'blur' },
        downloads,
      }
    })
    // Only the blurred thumbnail geometry depends on the UI scale.
    test('preserves thumbnail privacy preferences after disconnecting', { tag: preference === 'blur' ? '@scale' : [] }, async ({ app, page, uiScale }, testInfo) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
        window.dispatchEvent(new Event('offline'))
      })
      const image = page.locator('.offlineDownloadRecommendation').filter({ hasText: 'Saved audio 2' }).locator('img')
      await expectImagesLoaded(image)
      if (preference === 'hidden') {
        await expect(image).toHaveAttribute('src', /thumbnail_placeholder\.svg/)
      } else {
        await expect(image).toHaveAttribute('src', thumbnail)
        await expect.poll(() => image.evaluate(element => getComputedStyle(element).filter)).toMatch(/blur\(/)
        await image.scrollIntoViewIfNeeded()
        const bounds = await image.boundingBox()
        const gap = { x: bounds.x + bounds.width + 3, y: bounds.y + bounds.height / 2 - 4, width: 6, height: 8 }
        const blurred = await page.screenshot({ clip: gap })
        const visibility = await image.evaluate(element => {
          const original = element.style.visibility
          element.style.visibility = 'hidden'
          return original
        })
        let withoutImage
        try {
          withoutImage = await page.screenshot({ clip: gap })
        } finally {
          await image.evaluate((element, visibility) => { element.style.visibility = visibility }, visibility)
        }
        expect(blurred.equals(withoutImage), `Blur must stay out of the thumbnail/text gap at ${uiScale}%`).toBe(true)
        await page.locator('.watchVideoRecommendations').screenshot({ path: testInfo.outputPath('blurred-offline.png') })
      }
    })
  })
}
