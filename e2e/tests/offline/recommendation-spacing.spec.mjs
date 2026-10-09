import { test, expect } from '../../helpers/app.mjs'
import { activeTab, findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      baseTheme: 'system',
      systemDarkTheme: 'dark',
      systemLightTheme: 'light',
      mainColor: 'Red',
      secColor: 'Blue',
    }
  }
})

for (const offline of [false, true]) {
  test(`matches ${offline ? 'Available Offline' : 'Up Next'} heading spacing to the item gap`, async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await openMockedVideo(page)
    const watch = await page.evaluateHandle(findWatchComponent)
    try {
      await watch.evaluate((component, offline) => {
        const watch = component.proxy
        const videos = Array.from({ length: 3 }, (_, index) => ({
          videoId: `related000${index}`, title: `Suggested video ${index + 1}`, author: 'Sample channel', type: 'video',
        }))
        if (offline) {
          watch.$store.commit('upsertYtDlpDownload', {
            id: 1,
            status: 'completed',
            mode: 'video',
            files: videos.map(video => ({ ...video, path: `/offline-${video.videoId}.webm`, extension: 'webm' })),
          })
          watch.isOffline = true
          watch.localFilePlayback = true
        }
        watch.recommendedVideos = offline ? [] : videos
      }, offline)

      const card = page.locator(`${activeTab} .watchVideoRecommendations`)
      const rows = card.locator(offline ? '.offlineDownloadRecommendation' : '.ft-list-item')
      await expect(rows).toHaveCount(3)
      for (const scale of [100, 125]) {
        await watch.evaluate((component, scale) => component.proxy.$store.dispatch('updateUiScale', scale), scale)
        await expect.poll(() => card.evaluate(element => {
          const heading = element.querySelector('h3').getBoundingClientRect()
          const thumbnails = element.querySelectorAll('.offlineDownloadThumbnail, .thumbnailImage')
          const first = thumbnails[0].getBoundingClientRect()
          const second = thumbnails[1].getBoundingClientRect()
          const headingGap = first.top - heading.bottom
          const itemGap = second.top - first.bottom
          const topGap = heading.top - element.getBoundingClientRect().top
          return Math.max(Math.abs(headingGap - itemGap), Math.abs(topGap - itemGap))
        })).toBeLessThanOrEqual(0.1)
      }
      await watch.evaluate(component => component.proxy.$store.dispatch('updateUiScale', 100))
      await expectImagesLoaded(card.locator('img'))
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
        await card.screenshot({ path: testInfo.outputPath(`${offline ? 'offline' : 'up-next'}-spacing-${colorScheme}.png`) })
      }
    } finally {
      await watch.dispose()
    }
  })
}
