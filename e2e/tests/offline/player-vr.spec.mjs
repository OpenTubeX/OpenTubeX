import { test, expect, sel } from '../../helpers/app.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { DEMO_MEDIA_URL, demoPlayerResponse } from '../../helpers/media.mjs'

test.use({
  seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } },
  launchArgs: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

async function mockVrYtDlpInfo(app, initialHls = true, panoramicHls = true) {
  await app.electronApp.evaluate(({ ipcMain }, { mediaUrl, initialHls, panoramicHls }) => {
    globalThis.__vrAttempts = []
    ipcMain.removeHandler('yt-dlp-get-playback-info')
    ipcMain.handle('yt-dlp-get-playback-info', (_event, _id, defaults) => {
      globalThis.__vrAttempts.push(defaults)
      return {
        isLive: false,
        liveStatus: 'not_live',
        hlsManifestUrl: panoramicHls && (initialHls || defaults) ? 'https://vr.example.test/master.m3u8' : null,
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
          formatNote: '360s, mesh',
          dynamicRange: 'SDR',
          availableAt: null
        }],
        duration: 30,
        storyboardVtt: null,
        captions: [],
        captionTranslations: [],
        title: '360 video',
        version: 'test'
      }
    })
  }, { mediaUrl: DEMO_MEDIA_URL, initialHls, panoramicHls })
}

for (const rejectedHls of [false, true]) {
  test(`combined-only mesh streams play when panoramic HLS is ${rejectedHls ? 'rejected' : 'missing'}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://vr.example.test/master.m3u8', route => route.fulfill({ status: 403, body: 'Unavailable' }))
    await mockVrYtDlpInfo(app, true, rejectedHls)
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
      .dispatch('updateVideoPlaybackEngine', 'yt-dlp'))
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await page.locator('.videoLayout').waitFor()
    const watch = await watchViewHandle(page)
    await expect.poll(() => watch.evaluate(view => ({
      engine: view.activePlaybackEngine,
      projection: view.vrProjection,
      format: view.activeFormat,
      manifest: view.manifestSrc,
      error: view.errorMessage,
    }))).toEqual({ engine: 'yt-dlp', projection: 'MESH', format: 'legacy', manifest: null, error: null })
    await expect.poll(() => page.locator('.ftVideoPlayer video').first().evaluate(video => video.currentTime)).toBeGreaterThan(0)
    expect(await app.electronApp.evaluate(() => globalThis.__vrAttempts)).toEqual([false, true, true])
  })
}

test('yt-dlp retries panoramic extraction when backend projection metadata is absent', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  let manifestRequests = 0
  let releaseManifest
  await page.route('https://vr.example.test/master.m3u8', route => {
    if (++manifestRequests > 1) {
      return new Promise(resolve => {
        releaseManifest = () => resolve(route.fulfill({ contentType: 'application/x-mpegURL', body: '#EXTM3U\n' }))
      })
    }
    return route.fulfill({ contentType: 'application/x-mpegURL', body: '#EXTM3U\n' })
  })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .dispatch('updateVideoPlaybackEngine', 'yt-dlp'))
  await mockVrYtDlpInfo(app, false)
  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await page.locator('.videoLayout').waitFor()
  const watch = await watchViewHandle(page)
  await expect.poll(() => watch.evaluate(view => view.vrProjection)).toBe('EQUIRECTANGULAR')
  await expect(page.locator('.ftVideoPlayer .vrCanvas')).toBeVisible()
  expect(await app.electronApp.evaluate(() => globalThis.__vrAttempts)).toEqual([false, true])
  expect(await page.locator('.ftVideoPlayer video').first().evaluate(element => element.ui.getControls().isPlayingVR())).toBe(true)
  releaseManifest?.()
})

for (const suppliedHls of ['valid', 'missing', 'rejected', 'failed-child']) {
  test(suppliedHls === 'failed-child' ? 'built-in local panorama falls back to progressive playback after a child playlist fails' : `built-in mesh playback uses ${suppliedHls === 'valid' ? 'the supplied' : suppliedHls === 'rejected' ? 'a VR client after a rejected supplied' : 'a VR client'} panorama without yt-dlp`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    let vrRequests = 0
    let manifestRequests = 0
    let childRequests = 0
    const manifestBody = suppliedHls === 'failed-child'
      ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.42E01E,mp4a.40.2"\nhttps://vr.example.test/child.m3u8\n'
      : '#EXTM3U\n'
    let releaseManifest
    let releaseLookup
    const lookupGate = new Promise(resolve => { releaseLookup = resolve })
    let releaseProbe
    const probeGate = new Promise(resolve => { releaseProbe = resolve })
    await page.route('https://vr.example.test/**', async route => {
      if (route.request().url().includes('/child.m3u8')) {
        childRequests++
        return route.fulfill({ status: 404, body: 'Missing child playlist' })
      }
      if (route.request().url().includes('/stale.m3u8')) {
        return route.fulfill({ status: 403, body: 'Expired manifest' })
      }
      if (++manifestRequests > 1 && suppliedHls !== 'failed-child') {
        return new Promise(resolve => {
          releaseManifest = () => resolve(route.fulfill({ contentType: 'application/x-mpegURL', body: '#EXTM3U\n' }))
        })
      }
      await probeGate
      return route.fulfill({ contentType: 'application/x-mpegURL', body: manifestBody })
    })
    await page.route(/\/youtubei\/v1\/player(?:\?|$)/, async route => {
      const request = JSON.parse(route.request().postData() ?? '{}')
      const response = demoPlayerResponse(request.videoId ?? 'jNQXAC9IVRw')
      response.streamingData.formats[0].projectionType = 'MESH'
      if (request.context?.client?.clientName === 'VISIONOS') {
        vrRequests++
        await lookupGate
      }
      if (suppliedHls === 'valid' || suppliedHls === 'failed-child' || request.context?.client?.clientName === 'VISIONOS') {
        response.streamingData.hlsManifestUrl = 'https://vr.example.test/master.m3u8?expire=4102444800'
      } else if (suppliedHls === 'rejected') {
        response.streamingData.hlsManifestUrl = 'https://vr.example.test/stale.m3u8?expire=4102444800'
      }
      return route.fulfill({ json: response })
    })
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
      .dispatch('updatePlaybackEngineFallback', false))
    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__builtinVrExtractions = 0
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', () => { globalThis.__builtinVrExtractions++; return { error: 'Unexpected extraction' } })
    })
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await page.locator('.videoLayout').waitFor()
    const watch = await watchViewHandle(page)
    try {
      await expect.poll(() => watch.evaluate(view => ({ loading: view.isLoading, pending: view.vrStreamsPending })), { timeout: 3000 })
        .toEqual({ loading: false, pending: true })
      await expect(page.locator('.streamPlaceholder')).toBeVisible()
      await expect(page.locator('.ftVideoPlayer')).toHaveCount(0)
      await expect(page.locator('.infoSkeleton')).toHaveCount(0)
      await expect(page.locator('.watchVideoInfo .videoTitle')).toBeVisible()
      await expect(page.locator('.streamPlaceholderText')).toHaveText('Loading…')
    } finally {
      releaseLookup()
    }
    try {
      await expect.poll(() => manifestRequests, { timeout: 3000 }).toBe(1)
      await expect.poll(() => watch.evaluate(view => ({ loading: view.isLoading, pending: view.vrStreamsPending })))
        .toEqual({ loading: false, pending: true })
    } finally {
      releaseProbe()
    }
    if (suppliedHls === 'failed-child') {
      await expect.poll(() => watch.evaluate(view => ({ format: view.activeFormat, error: view.errorMessage })))
        .toEqual({ format: 'legacy', error: null })
      await expect.poll(() => page.locator('.ftVideoPlayer video').first().evaluate(video => video.currentTime)).toBeGreaterThan(0)
      expect(childRequests).toBeGreaterThan(0)
      expect(await app.electronApp.evaluate(() => globalThis.__builtinVrExtractions)).toBe(0)
      return
    }
    await expect.poll(() => watch.evaluate(view => ({
      loading: view.isLoading,
      engine: view.activePlaybackEngine,
      projection: view.vrProjection,
      manifest: view.manifestSrc?.split('?')[0],
    }))).toEqual({ loading: false, engine: 'built-in', projection: 'EQUIRECTANGULAR', manifest: 'https://vr.example.test/master.m3u8' })
    await expect(page.locator('.ftVideoPlayer .vrCanvas')).toBeVisible()
    expect(await page.locator('.ftVideoPlayer video').first().evaluate(element => element.ui.getControls().isPlayingVR())).toBe(true)
    expect(await app.electronApp.evaluate(() => globalThis.__builtinVrExtractions)).toBe(0)
    expect(vrRequests).toBe(suppliedHls === 'valid' ? 0 : 1)
    releaseManifest?.()
  })
}

test('disabled playback-engine fallback keeps a YouTube mesh video on built-in playback', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.route(/\/youtubei\/v1\/player(?:\?|$)/, route => {
    const videoId = JSON.parse(route.request().postData() ?? '{}').videoId ?? 'jNQXAC9IVRw'
    const response = demoPlayerResponse(videoId)
    response.streamingData.formats[0].projectionType = 'MESH'
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
  })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .dispatch('updatePlaybackEngineFallback', false))
  await app.electronApp.evaluate(({ ipcMain }) => {
    globalThis.__disabledVrExtractions = 0
    ipcMain.removeHandler('yt-dlp-get-playback-info')
    ipcMain.handle('yt-dlp-get-playback-info', () => { globalThis.__disabledVrExtractions++; return { error: 'Unexpected extraction' } })
  })
  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await page.locator('.videoLayout').waitFor()
  const watch = await watchViewHandle(page)
  await expect.poll(() => watch.evaluate(view => ({
    loading: view.isLoading,
    projection: view.vrProjection,
    engine: view.activePlaybackEngine,
    fallback: view.playbackEngineFallbackTarget
  }))).toEqual({ loading: false, projection: 'MESH', engine: 'built-in', fallback: null })
  expect(await app.electronApp.evaluate(() => globalThis.__disabledVrExtractions)).toBe(0)
})

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
  const bounds = await surface.boundingBox()
  const point = { x: bounds.x + bounds.width * 0.2, y: bounds.y + bounds.height * 0.2 }
  await page.clock.install()
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.clock.fastForward(750)
  expect(await page.evaluate(() => window.__vrTrickPlayCalls)).toEqual([])
  await page.mouse.up()

  const cursorAtPoint = () => page.evaluate(({ x, y }) =>
    getComputedStyle(document.elementFromPoint(x, y)).cursor, point)
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

for (const mode of ['yt-dlp', 'built-in', 'proxy', 'failed-child']) {
  test(`uses panoramic HLS for an Invidious mesh video (${mode})`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://vr.example.test/master.m3u8', route => route.fulfill({
      contentType: 'application/x-mpegURL', body: '#EXTM3U\n'
    }))
    const hlsRequests = []
    let childRequests = 0
    const manifestBody = mode === 'failed-child'
      ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.42E01E,mp4a.40.2"\nhttps://invidious.test/api/manifest/hls/child.m3u8\n'
      : '#EXTM3U\n'
    let releaseManifest
    await page.route('https://invidious.test/api/manifest/hls/**', route => {
      if (route.request().url().endsWith('/child.m3u8')) {
        childRequests++
        return route.fulfill({ status: 404, body: 'Missing child playlist' })
      }
      hlsRequests.push(route.request().url())
      if (hlsRequests.length > 1 && mode !== 'failed-child') {
        return new Promise(resolve => {
          releaseManifest = () => resolve(route.fulfill({ contentType: 'application/x-mpegURL', body: '#EXTM3U\n' }))
        })
      }
      return route.fulfill({ contentType: 'application/x-mpegURL', body: manifestBody })
    })
    await page.route('https://invidious.test/api/v1/videos/**', route => route.fulfill({
      json: {
        title: 'Invidious 360 video',
        hlsUrl: mode === 'yt-dlp' ? undefined : 'https://invidious.test/api/manifest/hls/id/jNQXAC9IVRw',
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
    await page.evaluate(async mode => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await Promise.all([
        store.dispatch('updateBackendPreference', 'invidious'),
        store.dispatch('updateDefaultInvidiousInstance', 'https://invidious.test'),
        store.dispatch('updateProxyVideos', mode === 'proxy'),
        store.dispatch('updatePlaybackEngineFallback', mode !== 'failed-child')
      ])
    }, mode)

    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await page.locator('.videoLayout').waitFor()
    const watch = await watchViewHandle(page)
    if (mode === 'failed-child') {
      await expect.poll(() => watch.evaluate(view => ({ engine: view.activePlaybackEngine, format: view.activeFormat, error: view.errorMessage })))
        .toEqual({ engine: 'built-in', format: 'legacy', error: null })
      await expect.poll(() => page.locator('.ftVideoPlayer video').first().evaluate(video => video.currentTime)).toBeGreaterThan(0)
      expect(childRequests).toBeGreaterThan(0)
      return
    }
    await expect.poll(() => watch.evaluate(view => ({
      activePlaybackEngine: view.activePlaybackEngine,
      vrProjection: view.vrProjection,
      builtInProjection: view.builtInPlaybackSource?.vrProjection ?? null
    }))).toEqual({
      activePlaybackEngine: mode === 'yt-dlp' ? 'yt-dlp' : 'built-in',
      vrProjection: 'EQUIRECTANGULAR',
      builtInProjection: mode === 'yt-dlp' ? 'MESH' : null
    })
    await expect(page.locator('.ftVideoPlayer .vrCanvas')).toBeVisible()
    if (mode !== 'yt-dlp') {
      expect(hlsRequests.length).toBeGreaterThan(0)
      expect(new URL(hlsRequests[0]).searchParams.get('local')).toBe(mode === 'proxy' ? 'true' : null)
    }
    releaseManifest?.()
  })
}
