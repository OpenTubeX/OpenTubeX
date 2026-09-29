import { test, expect, sel } from '../../helpers/app.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { DEMO_MEDIA_URL, demoPlayerResponse } from '../../helpers/media.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

async function mockVrYtDlpInfo(app) {
  await app.electronApp.evaluate(({ ipcMain }, mediaUrl) => {
    ipcMain.removeHandler('yt-dlp-get-playback-info')
    ipcMain.handle('yt-dlp-get-playback-info', () => ({
      isLive: false,
      liveStatus: 'not_live',
      hlsManifestUrl: 'https://vr.example.test/master.m3u8',
      formats: [{
        formatId: '18',
        url: `${mediaUrl}&expire=4102444800`,
        protocol: 'https',
        ext: 'webm',
        vcodec: 'vp9',
        acodec: 'opus',
        width: 640,
        height: 360,
        fps: 30,
        bitrate: 500_000,
        audioSampleRate: 44_100,
        audioChannels: 2,
        language: null,
        formatNote: '360p',
        dynamicRange: 'SDR',
        availableAt: null
      }],
      duration: 30,
      storyboardVtt: null,
      captions: [],
      captionTranslations: [],
      title: '360 video',
      version: 'test'
    }))
  }, DEMO_MEDIA_URL)
}

test('uses panoramic HLS for a YouTube mesh video', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  let manifestRequests = 0
  let releaseManifest
  await page.route('https://vr.example.test/master.m3u8', async route => {
    manifestRequests++
    if (manifestRequests > 1) {
      return new Promise(resolve => {
        releaseManifest = () => resolve(route.fulfill({
          contentType: 'application/x-mpegURL',
          body: '#EXTM3U\n'
        }))
      })
    }
    return route.fulfill({ contentType: 'application/x-mpegURL', body: '#EXTM3U\n' })
  })
  await page.route(/\/youtubei\/v1\/player(?:\?|$)/, route => {
    const videoId = JSON.parse(route.request().postData() ?? '{}').videoId ?? 'jNQXAC9IVRw'
    const response = demoPlayerResponse(videoId)
    response.streamingData.formats[0].projectionType = 'MESH'
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
  })

  await app.electronApp.evaluate(({ ipcMain }) => {
    globalThis.__vrCacheKeys = []
    ipcMain.removeHandler('yt-dlp-playback-cache-get')
    ipcMain.handle('yt-dlp-playback-cache-get', (_event, _videoId, cacheKey) => {
      globalThis.__vrCacheKeys.push(cacheKey)
      return JSON.parse(cacheKey).length === 2
        ? {
            expiryTime: Date.now() + 60 * 60 * 1000,
            source: {
              manifestSrc: 'https://vr.example.test/master.m3u8',
              manifestMimeType: 'application/x-mpegurl',
              legacyFormats: [],
              captions: [],
              captionTranslations: [],
              subtitlesIncluded: true,
              title: 'Cached mesh video',
              isLive: false,
              version: 'test'
            }
          }
        : null
    })
  })
  await mockVrYtDlpInfo(app)

  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await page.locator('.videoLayout').waitFor()
  const watch = await watchViewHandle(page)
  await expect.poll(() => watch.evaluate(view => ({
    activePlaybackEngine: view.activePlaybackEngine,
    activeFormat: view.activeFormat,
    manifestSrc: view.manifestSrc,
    vrProjection: view.vrProjection,
    builtInProjection: view.builtInPlaybackSource?.vrProjection
  }))).toEqual({
    activePlaybackEngine: 'yt-dlp',
    activeFormat: 'dash',
    manifestSrc: 'https://vr.example.test/master.m3u8',
    vrProjection: 'EQUIRECTANGULAR',
    builtInProjection: 'MESH'
  })

  const video = page.locator('.ftVideoPlayer video').first()
  await expect(video).toBeVisible()
  await expect(page.locator('.ftVideoPlayer .vrCanvas')).toBeVisible()
  expect(await video.evaluate(element => element.ui.getConfiguration().displayInVrMode)).toBe(true)
  expect(await app.electronApp.evaluate(() =>
    globalThis.__vrCacheKeys.some(cacheKey => JSON.parse(cacheKey).at(-1) === 'vr-hls'))).toBe(true)

  const surface = page.locator('.ftVideoPlayer .shaka-controls-container')
  await watch.evaluate(view => { view.$refs.player.hasLoaded = true })
  await surface.evaluate(element => {
    const shakaPlayer = element.closest('.ftVideoPlayer').querySelector('video').ui.getControls().getPlayer()
    window.__vrTrickPlayCalls = []
    shakaPlayer.trickPlay = (...args) => window.__vrTrickPlayCalls.push(args)
  })
  await surface.dispatchEvent('pointerdown', {
    button: 0,
    isPrimary: true,
    pointerId: 1,
    pointerType: 'mouse'
  })
  await page.waitForTimeout(750)
  expect(await page.evaluate(() => window.__vrTrickPlayCalls)).toEqual([])
  await surface.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse' })

  const bounds = await surface.boundingBox()
  const point = { x: bounds.x + bounds.width * 0.2, y: bounds.y + bounds.height * 0.2 }
  const cursorAtPoint = () => page.evaluate(({ x, y }) =>
    getComputedStyle(document.elementFromPoint(x, y)).cursor, point)
  await page.mouse.move(point.x, point.y)
  await expect.poll(cursorAtPoint).toBe('grab')
  await page.mouse.down()
  await expect.poll(cursorAtPoint).toBe('grabbing')
  await page.mouse.up()

  await video.evaluate(element => {
    window.__vrPaused = true
    window.__vrPlayCalls = 0
    window.__vrPauseCalls = 0
    Object.defineProperty(element, 'paused', { configurable: true, get: () => window.__vrPaused })
    element.play = () => {
      window.__vrPlayCalls++
      window.__vrPaused = false
      return Promise.resolve()
    }
    element.pause = () => {
      window.__vrPauseCalls++
      window.__vrPaused = true
    }
  })
  await page.mouse.click(point.x, point.y)
  expect(await video.evaluate(element => ({ paused: element.paused, play: window.__vrPlayCalls, pause: window.__vrPauseCalls })))
    .toEqual({ paused: false, play: 1, pause: 0 })

  await page.mouse.click(point.x, point.y)
  expect(await page.evaluate(() => window.__vrPauseCalls)).toBe(1)

  const dragPoint = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  await page.mouse.move(dragPoint.x, dragPoint.y)
  await page.mouse.down()
  await page.mouse.move(dragPoint.x + 80, dragPoint.y + 40, { steps: 5 })
  await page.mouse.up()
  expect(await page.evaluate(() => ({ play: window.__vrPlayCalls, pause: window.__vrPauseCalls })))
    .toEqual({ play: 1, pause: 1 })
  releaseManifest?.()
})

test('uses panoramic HLS for an Invidious mesh video', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.route('https://vr.example.test/master.m3u8', route => route.fulfill({
    contentType: 'application/x-mpegURL', body: '#EXTM3U\n'
  }))
  await page.route('https://invidious.test/api/v1/videos/**', route => route.fulfill({
    json: {
      title: 'Invidious 360 video',
      viewCount: 1,
      paid: false,
      subCountText: '1',
      likeCount: 1,
      dislikeCount: 0,
      genre: 'Entertainment',
      keywords: [],
      author: 'Test Channel',
      authorId: 'UC-test-channel-id',
      authorThumbnails: [],
      description: '',
      descriptionHtml: '',
      published: 1_700_000_000,
      recommendedVideos: [],
      liveNow: false,
      premiereTimestamp: 0,
      isFamilyFriendly: true,
      isPostLiveDvr: false,
      isListed: true,
      captions: [],
      lengthSeconds: 30,
      formatStreams: [{
        itag: 43,
        url: DEMO_MEDIA_URL,
        type: 'video/webm; codecs="vp9, opus"',
        quality: 'medium',
        size: '640x360',
        projectionType: 'MESH'
      }],
      adaptiveFormats: [{
        itag: 140,
        url: `${DEMO_MEDIA_URL}&expire=4102444800`,
        type: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: '128000',
        init: '0-700',
        index: '701-800',
        audioQuality: 'AUDIO_QUALITY_MEDIUM',
        audioSampleRate: '48000',
        audioChannels: 2
      }],
      videoThumbnails: [{ url: '/vi/jNQXAC9IVRw/hqdefault.jpg', width: 480, height: 360 }]
    }
  }))
  await mockVrYtDlpInfo(app)
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await Promise.all([
      store.dispatch('updateBackendPreference', 'invidious'),
      store.dispatch('updateDefaultInvidiousInstance', 'https://invidious.test')
    ])
  })

  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await page.locator('.videoLayout').waitFor()
  const watch = await watchViewHandle(page)
  await expect.poll(() => watch.evaluate(view => ({
    activePlaybackEngine: view.activePlaybackEngine,
    vrProjection: view.vrProjection,
    builtInProjection: view.builtInPlaybackSource?.vrProjection
  }))).toEqual({
    activePlaybackEngine: 'yt-dlp',
    vrProjection: 'EQUIRECTANGULAR',
    builtInProjection: 'MESH'
  })
  await expect(page.locator('.ftVideoPlayer .vrCanvas')).toBeVisible()
})
