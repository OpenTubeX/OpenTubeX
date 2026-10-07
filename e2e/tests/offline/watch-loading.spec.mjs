import { test, expect, sel } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { DEMO_MEDIA_MIME_TYPE, DEMO_MEDIA_URL, demoPlayerResponse } from '../../helpers/media.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

const videoId = 'jNQXAC9IVRw'
const instance = 'https://invidious.test'

for (const backend of ['local', 'invidious']) {
  test.describe(`${backend} watch loading`, () => {
    test.use({
      seed: {
        settings: {
          backendPreference: backend,
          defaultInvidiousInstance: instance,
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          defaultVideoFormat: 'legacy',
          useSponsorBlock: true,
          hideChapters: false,
        }
      }
    })

    test('starts playback while community chapters are pending', async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page)
      if (backend === 'local') {
        // The recorded /next page has automatic chapters. Use a page without
        // chapters so the real loader requests the community fallback.
        await page.route('**/youtubei/v1/next**', route => route.fulfill({ json: {} }))
        await page.route('**/youtubei/v1/player**', route => {
          const response = demoPlayerResponse(videoId)
          Object.assign(response.videoDetails, {
            title: 'Chapter loading test', author: 'Test Channel', channelId: 'UC-test-channel-id'
          })
          return route.fulfill({ json: response })
        })
      }
      if (backend === 'invidious') {
        await page.route(`${instance}/api/v1/videos/**`, route => route.fulfill({
          json: {
            title: 'Chapter loading test',
            author: 'Test Channel',
            authorId: 'UC-test-channel-id',
            authorThumbnails: [],
            videoThumbnails: [{ url: '/vi/jNQXAC9IVRw/hqdefault.jpg' }],
            description: '',
            descriptionHtml: '',
            viewCount: 1,
            likeCount: 1,
            dislikeCount: 0,
            subCountText: '1',
            published: 1700000000,
            recommendedVideos: [],
            captions: [],
            liveNow: false,
            isListed: true,
            isFamilyFriendly: true,
            lengthSeconds: 30,
            formatStreams: [{
              itag: 43,
              type: DEMO_MEDIA_MIME_TYPE,
              url: DEMO_MEDIA_URL,
              size: '640x360',
              qualityLabel: '360p',
              fps: 30,
              bitrate: '200000'
            }],
            adaptiveFormats: [{
              itag: 140,
              url: `${DEMO_MEDIA_URL}&dur=30`,
              type: 'audio/mp4; codecs="mp4a.40.2"',
              bitrate: '128000',
              init: '0-700',
              index: '701-800',
              audioQuality: 'AUDIO_QUALITY_MEDIUM',
              audioSampleRate: '48000',
              audioChannels: 2
            }]
          }
        }))
      }

      let finishChapters
      const chapterResponse = new Promise(resolve => { finishChapters = resolve })
      let chapterRequestPending = false
      await page.route('**/api/skipSegments/**', async route => {
        const actions = JSON.parse(new URL(route.request().url()).searchParams.get('actionTypes') ?? '[]')
        if (!actions.includes('chapter')) return route.fulfill({ json: [] })
        chapterRequestPending = true
        await chapterResponse
        await route.fulfill({
          json: [{
            videoID: videoId,
            segments: [{
              UUID: 'community-chapter',
              category: 'chapter',
              actionType: 'chapter',
              description: 'Late community chapter',
              segment: [0, 30],
              videoDuration: 30,
              votes: 1
            }]
          }]
        })
      })

      try {
        const startedAt = performance.now()
        const video = await openMockedVideo(page)
        await expect.poll(() => chapterRequestPending).toBe(true)
        const watch = await watchViewHandle(page)
        expect(await watch.evaluate(vm => vm.isLoading)).toBe(false)
        expect(await watch.evaluate(vm => vm.videoChapters)).toEqual([])
        await expect(page.locator('.infoSkeleton, .videoPlayerPlaceholder')).toHaveCount(0)
        await expect(page.locator('.videoTitle')).toBeVisible()
        await video.evaluate(element => element.pause())
        await testInfo.attach('playback-before-chapters', {
          body: JSON.stringify({ backend, playbackMs: performance.now() - startedAt, chapterRequestPending }),
          contentType: 'application/json'
        })
        await page.screenshot({ path: testInfo.outputPath('playback-before-chapters.png') })
        // Model an already-loaded storyboard so late chapters must also receive
        // their thumbnails, rather than depending on the initial player load.
        await video.evaluate(element => {
          const player = element.ui.getControls().getPlayer()
          player.getImageTracks = () => [{}]
          player.getThumbnails = async () => ({
            uris: ['https://images.test/chapter.jpg'],
            width: 160,
            height: 90,
            imageWidth: 160,
            imageHeight: 90,
            positionX: 0,
            positionY: 0,
            sprite: false
          })
        })
        finishChapters()
        await expect.poll(() => watch.evaluate(vm => vm.videoChapters.map(chapter => chapter.title)))
          .toEqual(['Late community chapter'])
        await expect(page.locator('.chapterMarker')).toHaveCount(1)
        await expect(page.locator('.ft-chapters-button').first()).toBeVisible()
        await expect.poll(() => watch.evaluate(vm => vm.videoChapterThumbnails.map(thumbnail => thumbnail?.url)))
          .toEqual(['https://images.test/chapter.jpg'])
        await watch.dispose()
      } finally {
        finishChapters()
      }
    })
  })
}

test.describe('local player request concurrency', () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true,
        useSponsorBlock: false,
        hidePaidPromotion: false,
      }
    }
  })

  test('starts playback before promotion details and displays the late disclosure', async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    let finishPromotion
    const promotionResponse = new Promise(resolve => { finishPromotion = resolve })
    let promotionPending = false
    await page.route('**/youtubei/v1/player**', async route => {
      const client = route.request().postDataJSON().context.client.clientName
      if (client !== 'ANDROID') return route.fallback()
      promotionPending = true
      await promotionResponse
      return route.fulfill({
        json: demoPlayerResponse(videoId, {
          paidContentOverlay: { paidContentOverlayRenderer: { durationMs: '60000' } }
        })
      })
    })
    try {
      const startedAt = performance.now()
      const video = await openMockedVideo(page)
      await expect.poll(() => promotionPending).toBe(true)
      const watch = await watchViewHandle(page)
      expect(await watch.evaluate(vm => vm.isLoading)).toBe(false)
      expect(await watch.evaluate(vm => vm.hasPaidPromotion)).toBe(false)
      await expect(page.locator('.infoSkeleton, .videoPlayerPlaceholder')).toHaveCount(0)
      await testInfo.attach('playback-before-promotion', {
        body: JSON.stringify({ playbackMs: performance.now() - startedAt, promotionPending }),
        contentType: 'application/json'
      })
      await video.evaluate(element => element.pause())
      await page.screenshot({ path: testInfo.outputPath('playback-before-promotion.png') })
      finishPromotion()
      await expect.poll(() => watch.evaluate(vm => vm.hasPaidPromotion)).toBe(true)
      await expect(page.locator('.paidPromotionBadge')).toBeVisible()
      expect(await watch.evaluate(vm => vm.paidPromotionDurationMs)).toBe(60000)
      await page.screenshot({ path: testInfo.outputPath('late-promotion-disclosure.png') })
      await watch.dispose()
    } finally {
      finishPromotion()
    }
  })

  test('fetches watch metadata while token generation is pending', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await app.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('generate-po-token')
      ipcMain.handle('generate-po-token', () => new Promise(resolve => {
        globalThis.finishLoadingTestToken = () => resolve('test-po-token')
      }))
    })
    let metadataRequested = false
    await page.route('**/youtubei/v1/next**', route => {
      metadataRequested = true
      return route.fallback()
    })
    const finishToken = () => app.electronApp.evaluate(() => globalThis.finishLoadingTestToken?.())
    try {
      await page.locator(sel.searchInput).fill(`https://www.youtube.com/watch?v=${videoId}`)
      await page.locator(sel.searchInput).press('Enter')
      await expect.poll(() => app.electronApp.evaluate(() => typeof globalThis.finishLoadingTestToken === 'function'))
        .toBe(true)
      await expect.poll(() => metadataRequested).toBe(true)
      await expect(page.locator('.infoSkeleton')).toBeVisible()
      await finishToken()
      await waitForPlayback(page)
      await expect(page.locator('.infoSkeleton, .videoPlayerPlaceholder')).toHaveCount(0)
    } finally {
      await finishToken()
    }
  })
})
