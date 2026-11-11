import { test, expect, sel } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
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

    if (backend === 'local') {
      test('starts playback when the storyboard specification has no boards', async ({ app, page }) => {
        await mockPlayableWatchPage(app, page)
        await page.route('**/youtubei/v1/player**', route => route.fulfill({
          json: demoPlayerResponse(videoId, {
            storyboards: { playerStoryboardSpecRenderer: { spec: '' } },
          }),
        }))
        await openMockedVideo(page)
        await expect(page.locator('.errorMessage')).not.toBeVisible()
      })
    }

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

      // The player finishes loading only after the storyboard request settles.
      // Hold it until the chapters have arrived, as on a slow instance.
      let finishStoryboard = () => {}
      if (backend === 'invidious') {
        const storyboardResponse = new Promise(resolve => { finishStoryboard = resolve })
        await page.route(`${instance}/api/v1/storyboards/**`, async route => {
          await storyboardResponse
          await route.fulfill({ status: 404 })
        })
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
        if (backend === 'invidious') {
          const storyboardFailed = page.waitForEvent('console', message => message.text().includes('addThumbnailsTrack'))
          finishStoryboard()
          await storyboardFailed
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
          await expect(page.locator('.chapterMarker')).toHaveCount(1)
        }
        const chaptersButton = page.locator('.ft-chapters-button').first()
        await expect(chaptersButton).toBeVisible()
        // Chapter thumbnails download storyboard sheets, so they wait for a chapter list to open.
        expect(await watch.evaluate(vm => vm.videoChapterThumbnails.filter(thumbnail => thumbnail?.url))).toEqual([])
        await chaptersButton.click()
        await expect.poll(() => watch.evaluate(vm => vm.videoChapterThumbnails.map(thumbnail => thumbnail?.url)))
          .toEqual(['https://images.test/chapter.jpg'])
        await watch.dispose()
      } finally {
        finishChapters()
        finishStoryboard()
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

  /**
   * Lets the mocked attestation mint tokens, so loads skip the watch page.
   * @param {import('@playwright/test').ElectronApplication} electronApp
   */
  function stubAttestation(electronApp) {
    return electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('mint-po-token')
      globalThis.mintedTokenVideoIds = []
      ipcMain.handle('mint-po-token', (_event, videoId) => {
        globalThis.mintedTokenVideoIds.push(videoId)
        return 'minted-po-token'
      })
    })
  }

  /** Counts loaded watch pages, and returns the /player of the locally generated sessions */
  async function routeDirectPlayer(page, directResponse) {
    const watchPages = []
    page.on('request', request => {
      if (request.url().startsWith('https://www.youtube.com/watch?')) watchPages.push(request.url())
    })
    await page.route('**/youtubei/v1/player**', route => {
      const { videoId, context } = route.request().postDataJSON()
      // The watch page's session has the visitor data of its ytcfg
      if (context.client.clientName !== 'WEB' || context.client.visitorData === 'e2e-visitor-data') return route.fallback()
      return route.fulfill({ json: directResponse(videoId) })
    })
    return watchPages
  }

  for (const changeVideo of [false, true]) {
    test(changeVideo
      ? 'late /next data of a previous video cannot replace the current one'
      : 'plays a warm video before its /next data arrives and fills it in afterwards', async ({ app, page }, testInfo) => {
      const nextVideoId = 'dQw4w9WgXc'
      await mockPlayableWatchPage(app, page)
      await stubAttestation(app.electronApp)
      const watchPages = await routeDirectPlayer(page, id => {
        const response = demoPlayerResponse(id)
        response.streamingData.serverAbrStreamingUrl = 'https://rr1---sn-test.googlevideo.com/videoplayback?expire=4102444800'
        Object.assign(response.videoDetails, { title: `Player title ${id}`, author: 'Test Channel', channelId: 'UC-test-channel-id' })
        return response
      })
      let finishNext
      const nextResponse = new Promise(resolve => { finishNext = resolve })
      let nextPending = false
      await page.route('**/youtubei/v1/next**', async route => {
        const body = route.request().postDataJSON()
        if (body.continuation) return route.fallback()
        if (body.videoId === nextVideoId) return route.fulfill({ json: {} })
        nextPending = true
        await nextResponse
        return route.fallback()
      })
      try {
        await openMockedVideo(page)
        expect(nextPending).toBe(true)
        const watch = await watchViewHandle(page)
        expect(await watch.evaluate(vm => [vm.isLoading, vm.watchNextPending, vm.recommendedVideos.length])).toEqual([false, true, 0])
        await expect(page.locator('.videoTitle')).toHaveText(`Player title ${videoId}`)
        await expect(page.locator('.infoSkeleton, .videoPlayerPlaceholder')).toHaveCount(0)

        if (changeVideo) {
          await openMockedVideo(page, nextVideoId)
          await expect(page.locator('.videoTitle')).toHaveText(`Player title ${nextVideoId}`)
          finishNext()
          await expect.poll(() => watch.evaluate(vm => vm.watchNextPending)).toBe(false)
          // Let the previous video's response settle before checking that it changed nothing
          await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
          expect(await watch.evaluate(vm => [vm.videoId, vm.recommendedVideos.length])).toEqual([nextVideoId, 0])
          await expect(page.locator('.videoTitle')).toHaveText(`Player title ${nextVideoId}`)
        } else {
          await page.screenshot({ path: testInfo.outputPath('playback-before-next.png') })
          const historyTitle = () => page.evaluate(id => window.$store.getters.getHistoryCacheById[id]?.title, videoId)
          await expect.poll(historyTitle).toBe(`Player title ${videoId}`)
          finishNext()
          await expect.poll(() => watch.evaluate(vm => vm.watchNextPending)).toBe(false)
          // Playback saved the /player title, which the /next data replaces
          const nextTitle = await watch.evaluate(vm => vm.videoTitle)
          expect(nextTitle).not.toBe(`Player title ${videoId}`)
          await expect.poll(historyTitle).toBe(nextTitle)
          expect(await watch.evaluate(vm => vm.recommendedVideos.length)).toBeGreaterThan(0)
          expect(await watch.evaluate(vm => vm.channelThumbnail)).not.toBe('')
          await expect(page.locator(`${activeTab} video`)).toHaveJSProperty('paused', false)
          await page.screenshot({ path: testInfo.outputPath('late-next-filled-in.png') })
        }
        expect(watchPages).toEqual([])
        expect(await app.electronApp.evaluate(() => globalThis.mintedTokenVideoIds))
          .toEqual(changeVideo ? [videoId, nextVideoId] : [videoId])
        await watch.dispose()
      } finally {
        finishNext()
      }
    })
  }

  test('loads the watch page instead when YouTube refuses the direct request, for the rest of the session', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await stubAttestation(app.electronApp)
    const watchPages = await routeDirectPlayer(page, () => ({
      playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' }
    }))
    await openMockedVideo(page)
    await expect(page.locator('.errorMessage')).not.toBeVisible()
    expect(watchPages).toHaveLength(1)
    await openMockedVideo(page, 'dQw4w9WgXc')
    expect(watchPages).toHaveLength(2)
    // The second video doesn't try the direct request again
    expect(await app.electronApp.evaluate(() => globalThis.mintedTokenVideoIds)).toEqual(['jNQXAC9IVRw'])
  })

  test('plays the WEB streams for the rest of the session when googlevideo refuses the visionOS streams', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/youtubei/v1/visitor_id**', route => route.fulfill({
      json: { responseContext: { visitorData: 'e2e-visionos-visitor-data' } }
    }))
    const visionOsRequests = []
    await page.route('**/youtubei/v1/player**', route => {
      const { videoId, context } = route.request().postDataJSON()
      if (context.client.clientName !== 'VISIONOS') return route.fallback()
      visionOsRequests.push(videoId)
      const url = itag => `https://rr1---sn-opentubex-visionos.googlevideo.com/videoplayback?id=${videoId}&itag=${itag}&c=VISIONOS`
      const format = { lastModified: '1700000000000000', approxDurationMs: '30000', contentLength: '100000' }
      return route.fulfill({
        json: {
          playabilityStatus: { status: 'OK' },
          videoDetails: { videoId, lengthSeconds: '30' },
          streamingData: {
            expiresInSeconds: '21540',
            adaptiveFormats: [{
              ...format,
              itag: 247,
              url: url(247),
              mimeType: 'video/webm; codecs="vp9"',
              bitrate: 500_000,
              width: 1280,
              height: 720,
              fps: 30,
              quality: 'hd720',
              qualityLabel: '720p',
              initRange: { start: '0', end: '219' },
              indexRange: { start: '220', end: '860' },
            }, {
              ...format,
              itag: 251,
              url: url(251),
              mimeType: 'audio/webm; codecs="opus"',
              bitrate: 128_000,
              audioQuality: 'AUDIO_QUALITY_MEDIUM',
              audioSampleRate: '48000',
              audioChannels: 2,
              initRange: { start: '0', end: '258' },
              indexRange: { start: '259', end: '629' },
            }]
          }
        }
      })
    })
    let refusedStreams = 0
    await page.route(/^https:\/\/rr1---sn-opentubex-visionos\.googlevideo\.com\//, route => {
      refusedStreams++
      return route.fulfill({ status: 403, body: '' })
    })

    // The reload after the refusal plays the watch page's demo stream
    await openMockedVideo(page)
    expect(refusedStreams).toBeGreaterThan(0)
    await openMockedVideo(page, 'dQw4w9WgXc')
    expect(visionOsRequests).toEqual(['jNQXAC9IVRw'])
  })

  for (const changeVideo of [false, true]) {
    test(changeVideo ? 'only requests a token for the current video after navigation during player-script setup' : 'fetches watch metadata while the player script is pending', async ({ app, page }, testInfo) => {
      const currentVideoId = 'dQw4w9WgXc'
      await mockPlayableWatchPage(app, page)
      await app.electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('generate-po-token')
        globalThis.loadingTestTokenVideoIds = []
        ipcMain.handle('generate-po-token', (_event, videoId) => {
          globalThis.loadingTestTokenVideoIds.push(videoId)
          return 'test-po-token'
        })
      })
      let finishScript
      const scriptResponse = new Promise(resolve => { finishScript = resolve })
      let scriptPending = false
      let metadataRequested = false
      await page.route('**/s/player/**', async route => {
        scriptPending = true
        await scriptResponse
        await route.fallback()
      })
      await page.route('**/youtubei/v1/next**', route => {
        metadataRequested = true
        if (route.request().postDataJSON().videoId === currentVideoId) return route.fulfill({ json: {} })
        return route.fallback()
      })
      try {
        const startedAt = performance.now()
        await page.locator(sel.searchInput).fill(`https://www.youtube.com/watch?v=${videoId}`)
        await page.locator(sel.searchInput).press('Enter')
        await expect.poll(() => scriptPending).toBe(true)
        await expect.poll(() => metadataRequested).toBe(true)
        expect(await app.electronApp.evaluate(() => globalThis.loadingTestTokenVideoIds)).toEqual([])
        await expect(page.locator('.infoSkeleton')).toBeVisible()
        if (changeVideo) {
          const currentMetadataRequest = page.waitForRequest(request => request.url().includes('/youtubei/v1/next') &&
            request.postDataJSON().videoId === currentVideoId)
          await page.locator(sel.searchInput).fill(`https://www.youtube.com/watch?v=${currentVideoId}`)
          await page.locator(sel.searchInput).press('Enter')
          await expect(page).toHaveURL(new RegExp(`#/watch/${currentVideoId}`))
          await currentMetadataRequest
          const promotionRequest = page.waitForRequest(request => request.url().includes('/youtubei/v1/player') &&
            request.postDataJSON().context.client.clientName === 'ANDROID')
          finishScript()
          await promotionRequest
          await waitForPlayback(page)
          expect(await app.electronApp.evaluate(() => globalThis.loadingTestTokenVideoIds)).toEqual([currentVideoId])
          return
        }
        finishScript()
        await waitForPlayback(page)
        expect(await app.electronApp.evaluate(() => globalThis.loadingTestTokenVideoIds)).toEqual([videoId])
        await expect(page.locator('.infoSkeleton, .videoPlayerPlaceholder')).toHaveCount(0)
        await testInfo.attach('playback-with-concurrent-startup', {
          body: JSON.stringify({ playbackMs: performance.now() - startedAt }),
          contentType: 'application/json'
        })
        await page.screenshot({ path: testInfo.outputPath('playback-with-concurrent-startup.png') })
      } finally {
        finishScript()
      }
    })
  }
})
