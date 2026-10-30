import { sel, setWindowSize, test, expect } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import {
  DEMO_MEDIA_URL,
  POST_LIVE_AUDIO_URL,
  POST_LIVE_VIDEO_URL,
  demoPlayerResponse,
  routePostLiveMedia
} from '../../helpers/media.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

/**
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, string>} manifests
 */
async function routePostLivePlayer(page, manifests) {
  await page.route(/\/youtubei\/v1\/player/, (route, request) => {
    const videoId = JSON.parse(request.postData() ?? '{}').videoId ?? 'jNQXAC9IVRw'
    const response = demoPlayerResponse(videoId)
    response.videoDetails.isLiveContent = true
    response.videoDetails.isPostLiveDvr = true
    response.streamingData = {
      expiresInSeconds: '21540',
      formats: [],
      adaptiveFormats: [],
      ...manifests
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    })
  })
}

async function mockPostLiveYtDlp(app) {
  await app.electronApp.evaluate(({ ipcMain }, playbackInfo) => {
    globalThis.__ytDlpPostLiveCalls = 0
    ipcMain.removeHandler('yt-dlp-get-playback-info')
    ipcMain.handle('yt-dlp-get-playback-info', () => {
      globalThis.__ytDlpPostLiveCalls++
      return playbackInfo
    })
  }, {
    isLive: false,
    liveStatus: 'post_live',
    hlsManifestUrl: null,
    formats: [{
      formatId: '134',
      url: POST_LIVE_VIDEO_URL,
      manifestUrl: null,
      protocol: 'http_dash_segments',
      ext: 'mp4',
      container: 'mp4_dash',
      vcodec: 'avc1.42c00d',
      acodec: 'none',
      width: 320,
      height: 180,
      fps: 30,
      bitrate: 20_000,
      audioSampleRate: null,
      audioChannels: null,
      language: null,
      formatNote: '180p',
      dynamicRange: 'SDR',
      availableAt: null,
      targetDuration: 2,
      fragmentCount: 1
    }, {
      formatId: '140',
      url: POST_LIVE_AUDIO_URL,
      manifestUrl: null,
      protocol: 'http_dash_segments',
      ext: 'm4a',
      container: 'm4a_dash',
      vcodec: 'none',
      acodec: 'mp4a.40.2',
      width: null,
      height: null,
      fps: null,
      bitrate: 64_000,
      audioSampleRate: 44_100,
      audioChannels: 2,
      language: null,
      formatNote: 'medium',
      dynamicRange: null,
      availableAt: null,
      targetDuration: 2,
      fragmentCount: 1
    }],
    duration: 2,
    storyboardVtt: null,
    title: 'Recently ended live stream',
    captions: [],
    captionTranslations: [],
    version: 'test'
  })
}

test('shows the restricted playback setup hint and loads yt-dlp subtitles after an authenticated retry', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.route('https://example.invalid/restricted-en.vtt', route => route.fulfill({
    contentType: 'text/vtt',
    body: 'WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nRestricted caption\n'
  }))
  await page.route('https://example.invalid/restricted-de.vtt', route => route.fulfill({
    contentType: 'text/vtt',
    body: 'WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nEingeschränkte Untertitel\n'
  }))
  await openMockedVideo(page)

  const watchView = await watchViewHandle(page)
  await watchView.evaluate(async (view) => {
    view.isLoading = false
    view.captions = []
    view.captionTranslations = []
    view.playbackEngineFallbackTarget = 'built-in'
    view.setRestrictedPlaybackError('age')
    await view.$nextTick()
  })

  await expect(page.getByText(
    'Configure cookies in Settings → Advanced → External Software → yt-dlp Cookies.'
  )).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)

  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateYtDlpPlaybackAuthMode', 'browser')
    await store.dispatch('updateYtDlpPlaybackCookiesBrowser', 'firefox')
  })
  await app.electronApp.evaluate(({ ipcMain }, demoMediaUrl) => {
    globalThis.__restrictedPlaybackCalls = []
    ipcMain.removeHandler('yt-dlp-get-playback-info')
    ipcMain.handle(
      'yt-dlp-get-playback-info',
      (_event, _videoId, useDefaultClients, useAuthentication, includeSubtitles) => {
        globalThis.__restrictedPlaybackCalls.push({ useDefaultClients, useAuthentication, includeSubtitles })
        return {
          isLive: false,
          liveStatus: 'not_live',
          hlsManifestUrl: null,
          formats: [{
            formatId: '18',
            url: `${demoMediaUrl}&expire=4102444800`,
            manifestUrl: null,
            protocol: 'https',
            ext: 'webm',
            container: 'webm',
            vcodec: 'vp9',
            acodec: 'opus',
            width: 640,
            height: 360,
            fps: 30,
            bitrate: 500000,
            audioSampleRate: 44100,
            audioChannels: 2,
            language: null,
            formatNote: '360p',
            dynamicRange: 'SDR',
            availableAt: null
          }],
          duration: 60,
          storyboardVtt: null,
          captions: [{
            url: 'https://example.invalid/restricted-en.vtt',
            language: 'en',
            label: 'English',
            mimeType: 'text/vtt',
            isAutoGenerated: true
          }],
          captionTranslations: [{
            url: 'https://example.invalid/restricted-de.vtt',
            language: 'de',
            label: 'German from English',
            translationName: 'German',
            originalLanguage: 'en',
            mimeType: 'text/vtt',
            id: 'yt-dlp:de'
          }],
          title: 'Restricted video',
          version: 'test'
        }
      }
    )
  }, DEMO_MEDIA_URL)
  await watchView.evaluate((view) => {
    const extractYtDlpPlaybackSource = view.extractYtDlpPlaybackSource
    view.extractYtDlpPlaybackSource = async (...args) => {
      const applied = await extractYtDlpPlaybackSource.apply(view, args)
      window.__restrictedPlaybackResult = {
        applied,
        activeEngine: view.activePlaybackEngine,
        activeFormat: view.activeFormat,
        legacyFormats: view.legacyFormats.length,
        manifest: view.manifestSrc
      }
      return applied
    }
  })

  await expect(page.getByText(
    'Configure cookies in Settings → Advanced → External Software → yt-dlp Cookies.'
  )).toHaveCount(0)
  const retry = page.getByRole('button', { name: 'Try with configured cookies' })
  await expect(retry).toBeVisible()
  await retry.click()

  await expect.poll(() => app.electronApp.evaluate(
    () => globalThis.__restrictedPlaybackCalls
  )).toEqual([{ useDefaultClients: false, useAuthentication: true, includeSubtitles: true }])
  await expect.poll(() => page.evaluate(
    () => window.__restrictedPlaybackResult
  )).toEqual({
    applied: true,
    activeEngine: 'yt-dlp',
    activeFormat: 'legacy',
    legacyFormats: 1,
    manifest: null
  })
  expect(await watchView.evaluate((view) => view.playbackEngineFallbackTarget)).toBeNull()
  const translatedCaptionLabel = await watchView.evaluate((view) => {
    return view.t('Video.Player.TranslatedCaptionTemplate', {
      language: 'German',
      originalLanguage: 'English'
    })
  })

  await expect.poll(() => watchView.evaluate((view) => ({
    captions: view.captions,
    captionTranslations: view.captionTranslations
  }))).toEqual({
    captions: [{
      url: 'https://example.invalid/restricted-en.vtt',
      language: 'en',
      label: 'English (auto-generated)',
      mimeType: 'text/vtt',
      isAutoGenerated: true
    }],
    captionTranslations: [{
      url: 'https://example.invalid/restricted-de.vtt',
      language: 'de',
      label: translatedCaptionLabel,
      translationName: 'German',
      originalLanguage: 'en',
      mimeType: 'text/vtt',
      id: 'yt-dlp:de',
      isAutotranslated: true
    }]
  })

  await waitForPlayback(page)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await expect.poll(() => player.evaluate(element => {
    return element.ui.getControls().getPlayer().getTextTracks().map(track => ({
      language: track.language,
      label: track.label
    }))
  })).toContainEqual({ language: 'en', label: 'English (auto-generated)' })

  await player.hover()
  const moreOptions = player.getByRole('button', { name: 'More settings' })
  await moreOptions.click()
  await player.locator('.shaka-overflow-menu').getByRole('button', { name: 'Captions' }).click()
  await expect(player).toBeVisible()
  await expect(player.locator('.dlnaCastControl')).toHaveCount(0)
  await player.locator('.shaka-text-languages').getByRole('button', { name: 'Auto-translate' }).click()
  await player.locator('.ft-caption-translation-options').getByRole('button', { name: 'German' }).click()
  await expect.poll(() => player.evaluate(element => {
    return element.ui.getControls().getPlayer().getTextTracks().map(track => ({
      language: track.language,
      label: track.label
    }))
  })).toContainEqual({
    language: 'de',
    label: translatedCaptionLabel
  })
  // yt-dlp translations are remembered for later videos like the local API's
  await expect.poll(() => page.evaluate(() => window.$store.getters.getAutoTranslatedCaptionLocale)).toBe('de')

  await watchView.evaluate(async (view) => {
    window.__restrictedPlaybackResult = null
    view.manifestSrc = null
    view.legacyFormats = []
    view.activeFormat = 'dash'
    view.activePlaybackEngine = 'built-in'
    view.playbackEngineFallbackTarget = 'built-in'
    view.setRestrictedPlaybackError('age')
    await view.$nextTick()
  })

  await expect.poll(() => page.evaluate(
    () => window.__restrictedPlaybackResult
  )).toEqual({
    applied: true,
    activeEngine: 'yt-dlp',
    activeFormat: 'legacy',
    legacyFormats: 1,
    manifest: null
  })
  await expect.poll(() => app.electronApp.evaluate(
    () => globalThis.__restrictedPlaybackCalls
  )).toEqual([{ useDefaultClients: false, useAuthentication: true, includeSubtitles: true }])
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)
})

test('opens yt-dlp captions with the remembered auto-translation', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await page.evaluate(() => window.$store.dispatch('updateAutoTranslatedCaptionLocale', 'de'))
  await app.electronApp.evaluate(({ ipcMain }, demoMediaUrl) => {
    ipcMain.removeHandler('yt-dlp-get-playback-info')
    ipcMain.handle('yt-dlp-get-playback-info', () => ({
      isLive: false,
      liveStatus: 'not_live',
      hlsManifestUrl: null,
      formats: [{
        formatId: '18',
        url: `${demoMediaUrl}&expire=4102444800`,
        manifestUrl: null,
        protocol: 'https',
        ext: 'webm',
        container: 'webm',
        vcodec: 'vp9',
        acodec: 'opus',
        width: 640,
        height: 360,
        fps: 30,
        bitrate: 500000,
        audioSampleRate: 44100,
        audioChannels: 2,
        language: null,
        formatNote: '360p',
        dynamicRange: 'SDR',
        availableAt: null
      }],
      duration: 60,
      storyboardVtt: null,
      captions: [
        { url: 'https://example.invalid/ko.vtt', language: 'ko', label: 'Korean', mimeType: 'text/vtt', isAutoGenerated: true },
        { url: 'https://example.invalid/de.vtt', language: 'de', label: 'German', mimeType: 'text/vtt', isAutoGenerated: false },
      ],
      captionTranslations: [
        { url: 'https://example.invalid/ko-de.vtt', language: 'de', label: 'German from Korean', translationName: 'German', originalLanguage: 'ko', mimeType: 'text/vtt', id: 'yt-dlp:de' },
        { url: 'https://example.invalid/ko-en.vtt', language: 'en', label: 'English from Korean', translationName: 'English', originalLanguage: 'ko', mimeType: 'text/vtt', id: 'yt-dlp:en' },
      ],
      title: 'Remembered translation video',
      version: 'test'
    }))
  }, DEMO_MEDIA_URL)

  const watchView = await watchViewHandle(page)
  // The translation wins over the video's own German captions
  expect(await watchView.evaluate(async (view) => {
    view.captions = []
    view.captionTranslations = []
    view.playbackEngineFallbackTarget = 'yt-dlp'
    await view.extractYtDlpPlaybackSource(view.videoLoadGeneration, view.videoId, view.playbackEngineSwitchGeneration)
    return view.captions.filter(caption => caption.isPreferredTranslation).map(caption => caption.url)
  })).toEqual(['https://example.invalid/ko-de.vtt'])
})

test('uses configured cookies for every yt-dlp extraction when enabled', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateYtDlpPlaybackAuthMode', 'browser')
    await store.dispatch('updateYtDlpPlaybackCookiesBrowser', 'firefox')
    await store.dispatch('updateYtDlpPlaybackAlwaysUseCookies', true)
  })
  await app.electronApp.evaluate(({ ipcMain }) => {
    globalThis.__alwaysUseCookiesCalls = []
    ipcMain.removeHandler('yt-dlp-get-playback-info')
    ipcMain.handle(
      'yt-dlp-get-playback-info',
      (_event, _videoId, useDefaultClients, useAuthentication) => {
        globalThis.__alwaysUseCookiesCalls.push({ useDefaultClients, useAuthentication })
        return { error: 'expected test extraction failure' }
      }
    )
  })

  const watchView = await watchViewHandle(page)
  expect(await watchView.evaluate((view) => {
    view.playbackEngineFallbackTarget = 'yt-dlp'
    return view.extractYtDlpPlaybackSource(
      view.videoLoadGeneration,
      view.videoId,
      view.playbackEngineSwitchGeneration
    )
  })).toBe(false)
  expect(await app.electronApp.evaluate(() => globalThis.__alwaysUseCookiesCalls)).toEqual([
    { useDefaultClients: false, useAuthentication: true },
    { useDefaultClients: true, useAuthentication: true },
    { useDefaultClients: true, useAuthentication: true }
  ])
})

test.describe('watch page', () => {
  for (const playbackEngine of ['built-in', 'yt-dlp']) {
    test(`${playbackEngine} respects live and premiere seeking limits`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      const video = await openMockedVideo(page)
      const watchView = await watchViewHandle(page)
      await watchView.evaluate((view, engine) => { view.activePlaybackEngine = engine }, playbackEngine)

      let liveDetails = {}
      await page.route(/\/youtubei\/v1\/player/, (route, request) => {
        const videoId = JSON.parse(request.postData() ?? '{}').videoId
        const response = demoPlayerResponse(videoId)
        Object.assign(response.videoDetails, liveDetails)
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) })
      })

      const seekBar = page.locator(`${activeTab} .shaka-seek-bar`)
      for (const scenario of [
        { details: { isLive: true, isLiveContent: true, isLiveDvrEnabled: false }, dvr: false, premiere: false },
        { details: { isLive: true, isLiveContent: true, isLiveDvrEnabled: true }, dvr: true, premiere: false },
        { details: { isLive: true, isLiveContent: false }, dvr: null, premiere: true }
      ]) {
        liveDetails = scenario.details
        await watchView.evaluate(view => view.getVideoInformationLocal(view.videoLoadGeneration, true))
        expect(await watchView.evaluate(view => ({
          live: view.isLive,
          dvr: view.isLiveDvrEnabled,
          premiere: view.isPremiere
        }))).toEqual({ live: true, dvr: scenario.dvr, premiere: scenario.premiere })
        const seekingAllowed = playbackEngine === 'yt-dlp' && scenario.dvr !== false
        await expect(seekBar).toHaveCount(seekingAllowed ? 1 : 0)

        await video.evaluate(element => {
          element.pause()
          element.currentTime = 10
        })
        await page.keyboard.press('ArrowLeft')
        await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(seekingAllowed ? 5 : 10, 3)

        await watchView.evaluate(view => view.changeTimestamp(3))
        await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(seekingAllowed ? 3 : 10, 3)

        await watchView.evaluate(async view => {
          view.videoChapters = [
            { title: 'First chapter', startSeconds: 0 },
            { title: 'Second chapter', startSeconds: 5 }
          ]
          view.videoCurrentChapterIndex = 1
          await view.$nextTick()
        })
        await page.keyboard.press('Control+ArrowLeft')
        await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(seekingAllowed ? 0 : 10, 3)
      }

      await watchView.evaluate(view => { view.isLiveDvrEnabled = false })
      liveDetails = {}
      await openMockedVideo(page, 'dQw4w9WgXcQ')
      const nextWatchView = await watchViewHandle(page)
      expect(await nextWatchView.evaluate(view => view.isLiveDvrEnabled)).toBeNull()
      await expect(seekBar).toHaveCount(1)
    })
  }

  test('skips known unavailable playlist videos when enabled and stops at the end', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async view => {
      view.$store.commit('addPlaylist', {
        _id: 'ft-playlist--skip-test',
        playlistName: 'Skip test',
        videos: [
          { videoId: 'jNQXAC9IVRw', playlistItemId: 'first', title: 'First' },
          { videoId: 'dQw4w9WgXcQ', playlistItemId: 'second', title: 'Second' },
          { videoId: '9bZkp7q19f0', playlistItemId: 'third', title: 'Third' },
        ]
      })
      await view.$store.dispatch('updateUserPlaylistSortOrder', 'custom')
      await view.$store.dispatch('updateAutoplayVideos', false)
      if (view.$store.getters.getSkipUnavailablePlaylistVideos !== true) {
        throw new Error('Skipping unavailable playlist videos should be enabled by default')
      }
      await view.$store.dispatch('updateSkipUnavailablePlaylistVideos', false)
      await view.tabRouter.push({
        path: '/watch/jNQXAC9IVRw',
        query: { playlistId: 'ft-playlist--skip-test', playlistType: 'user', playlistItemId: 'first' }
      })
    })
    await expect.poll(() => watchView.evaluate(view => view.watchingPlaylist && !!view.$refs.watchVideoPlaylist)).toBe(true)
    await page.locator(`${activeTab} .watchVideoPlaylist`).getByRole('button', { name: 'Loop Playlist' }).click()

    await watchView.evaluate(view => view.setNonRetryablePlaybackError('private'))
    await expect(page).toHaveURL(/playlistItemId=first/)

    await watchView.evaluate(async view => {
      await view.$store.dispatch('updateSkipUnavailablePlaylistVideos', true)
    })
    await expect(page).toHaveURL(/watch\/dQw4w9WgXcQ.*playlistItemId=second/)
    await expect.poll(() => watchView.evaluate(view => !view.isLoading)).toBe(true)

    await watchView.evaluate(view => view.setRestrictedPlaybackError('members'))
    await expect(page).toHaveURL(/watch\/9bZkp7q19f0.*playlistItemId=third/)
    await expect.poll(() => watchView.evaluate(view => !view.isLoading)).toBe(true)

    await watchView.evaluate(view => view.setNonRetryablePlaybackError('private'))
    await expect.poll(() => watchView.evaluate(view => view.$refs.watchVideoPlaylist.getState().loop)).toBe(true)
    // Give an unwanted skip time to navigate.
    await page.waitForTimeout(500)
    await expect(page).toHaveURL(/watch\/9bZkp7q19f0.*playlistItemId=third/)
  })

  test('skips an unavailable last item after playlist loop is enabled', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async view => {
      view.$store.commit('addPlaylist', {
        _id: 'ft-playlist--loop-test',
        playlistName: 'Loop test',
        videos: [
          { videoId: 'dQw4w9WgXcQ', playlistItemId: 'first', title: 'First' },
          { videoId: 'jNQXAC9IVRw', playlistItemId: 'last', title: 'Last' },
        ]
      })
      await view.$store.dispatch('updateUserPlaylistSortOrder', 'custom')
      await view.$store.dispatch('updateAutoplayVideos', false)
      await view.tabRouter.push({
        path: '/watch/jNQXAC9IVRw',
        query: { playlistId: 'ft-playlist--loop-test', playlistType: 'user', playlistItemId: 'last' }
      })
    })
    await expect.poll(() => watchView.evaluate(view => !view.isLoading && !!view.$refs.watchVideoPlaylist)).toBe(true)

    await watchView.evaluate(view => view.setNonRetryablePlaybackError('private'))
    await expect(page).toHaveURL(/watch\/jNQXAC9IVRw.*playlistItemId=last/)

    await page.locator(`${activeTab} .watchVideoPlaylist`).getByRole('button', { name: 'Loop Playlist' }).click()
    await expect(page).toHaveURL(/watch\/dQw4w9WgXcQ.*playlistItemId=first/)
  })

  test('tries downloaded playback before reporting an Invidious private video', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    let invidiousRequests = 0
    await page.route('https://invidious.test/api/v1/videos/**', route => {
      invidiousRequests++
      return route.fulfill({ json: { error: 'Private video' } })
    })

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async view => {
      await view.$store.dispatch('updateDefaultInvidiousInstance', 'https://invidious.test')
      await view.$store.dispatch('updateBackendPreference', 'invidious')
      view.finishDownloadedPlaybackWithoutMetadata = () => {
        window.__downloadFallbackUsed = true
        return true
      }
      view.getVideoInformationInvidious()
    })

    await expect.poll(() => invidiousRequests).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => window.__downloadFallbackUsed === true)).toBe(true)
    expect(await watchView.evaluate(view => view.nonRetryablePlaybackError)).toBeNull()
  })

  test('keeps private and DRM errors ineligible for extraction retry after locale changes', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      view.setNonRetryablePlaybackError('private')
      await view.$nextTick()
    })
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateCurrentLocale', 'de-DE')
    })
    await expect.poll(() => watchView.evaluate(view => view.currentLocale)).toBe('de-DE')
    expect(await watchView.evaluate(view => view.errorMessage === view.t('Video.Private'))).toBe(false)
    await expect(page.locator('.errorActions')).toHaveCount(0)

    await watchView.evaluate(async (view) => {
      view.setNonRetryablePlaybackError('drm')
      await view.$nextTick()
    })
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateCurrentLocale', 'en-US')
    })
    await expect.poll(() => watchView.evaluate(view => view.currentLocale)).toBe('en-US')
    expect(await watchView.evaluate(view => view.errorMessage === view.t('Video.DRMProtected'))).toBe(false)
    await expect(page.locator('.errorActions')).toHaveCount(0)
  })

  test('retries an error with the other extraction method without changing the default', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
    await page.route('https://example.invalid/retry.m3u8', route => route.fulfill({
      contentType: 'application/x-mpegURL',
      body: '#EXTM3U\n'
    }))
    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ytDlpRetryIncludeSubtitles = []
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', (_event, _videoId, _useDefaultClients, _useAuthentication, includeSubtitles) => {
        globalThis.__ytDlpRetryIncludeSubtitles.push(includeSubtitles)
        if (includeSubtitles) {
          return { error: 'subtitle extraction failed' }
        }

        return {
          isLive: false,
          liveStatus: 'not_live',
          hlsManifestUrl: 'https://example.invalid/retry.m3u8',
          formats: [{
            protocol: 'm3u8_native',
            url: 'https://example.invalid/unused?expire=4102444800',
            vcodec: null,
            acodec: null
          }],
          duration: 600,
          version: 'test'
        }
      })
    })
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    await watchView.evaluate((view) => {
      // This test exercises manual extraction retries. The empty HLS fixture is
      // not playable, so ignore its player error instead of racing the manual switch.
      view.handlePlayerError = () => {}
    })
    const builtInManifest = await watchView.evaluate((view) => view.manifestSrc)
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUiScale', 125)
    })
    await watchView.evaluate(async (view) => {
      view.errorMessage = 'The built-in extraction failed'
      await view.$nextTick()
    })

    const ytDlpRetry = page.getByRole('button', { name: 'Retry with yt-dlp extraction' })
    const [buttonBounds, errorBounds] = await Promise.all([
      ytDlpRetry.boundingBox(),
      page.locator('.errorWrapper').boundingBox()
    ])
    expect(buttonBounds.x).toBeGreaterThanOrEqual(errorBounds.x)
    expect(buttonBounds.x + buttonBounds.width).toBeLessThanOrEqual(errorBounds.x + errorBounds.width)
    await ytDlpRetry.click()
    await expect.poll(() => watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      errorMessage: view.errorMessage,
      manifest: view.manifestSrc,
      streamsPending: view.ytDlpStreamsPending
    }))).toEqual({
      activeEngine: 'yt-dlp',
      errorMessage: null,
      manifest: 'https://example.invalid/retry.m3u8',
      streamsPending: false
    })
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpRetryIncludeSubtitles)).toEqual([false])

    await watchView.evaluate(async (view) => {
      view.errorMessage = 'The yt-dlp extraction failed'
      await view.$nextTick()
      await view.retryWithOtherPlaybackEngine()
    })
    await expect.poll(() => watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      errorMessage: view.errorMessage,
      manifest: view.manifestSrc,
      streamsPending: view.ytDlpStreamsPending
    }))).toEqual({
      activeEngine: 'built-in',
      errorMessage: null,
      manifest: builtInManifest,
      streamsPending: false
    })
    await waitForPlayback(page)
    expect(await page.evaluate(() => {
      const store = window.$store
      return store.getters.getVideoPlaybackEngine
    })).toBe('built-in')

    expect(await watchView.evaluate(async (view) => {
      view.captions = []
      view.playbackEngineFallbackTarget = 'yt-dlp'
      return view.extractYtDlpPlaybackSource(
        view.videoLoadGeneration,
        view.videoId,
        view.playbackEngineSwitchGeneration
      )
    })).toBe(true)
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpRetryIncludeSubtitles))
      .toEqual([false, true, true, true])
  })

  test('shows the automatic yt-dlp live fallback while streams are pending', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      view.isLive = true
      view.manifestSrc = null
      view.legacyFormats = []
      view.playbackEngineFallbackTarget = null
      view.ytDlpStreamsPending = true
      await view.$nextTick()
    })

    await page.getByRole('button', { name: 'Change Media Formats' }).click()
    const prompt = page.getByRole('dialog', { name: 'Change Media Formats' })
    const ytDlp = prompt.getByRole('button', { name: 'yt-dlp' })
    const builtIn = prompt.getByRole('button', { name: 'Built-in' })

    await expect(ytDlp).toHaveAttribute('aria-pressed', 'true')
    await expect(builtIn).toHaveAttribute('aria-pressed', 'false')
    await expect(ytDlp.locator('.engineOptionCheck')).toBeVisible()
    await expect(builtIn.locator('.engineOptionCheck')).toHaveCount(0)
    await expect(prompt.locator('.engineBadge')).toHaveText('yt-dlp')
    await expect(prompt.getByTitle('Streaming protocol')).toHaveCount(0)

    await builtIn.click()
    await expect(prompt).toHaveCount(0)
    expect(await watchView.evaluate((view) => ({
      pending: view.ytDlpStreamsPending,
      target: view.playbackEngineFallbackTarget
    }))).toEqual({
      pending: false,
      target: 'built-in'
    })
  })

  test('shares a pending yt-dlp extraction after rapid engine switches', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://example.invalid/*.m3u8', route => route.fulfill({
      contentType: 'application/x-mpegURL',
      body: '#EXTM3U\n'
    }))
    await openMockedVideo(page)

    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ytDlpPlaybackResolvers = []
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', () => new Promise(resolve => {
        globalThis.__ytDlpPlaybackResolvers.push(resolve)
      }))
    })

    const watchView = await watchViewHandle(page)
    const builtInManifest = await watchView.evaluate((view) => view.manifestSrc)
    await watchView.evaluate((view) => {
      window.__firstEngineSwitch = view.handlePlaybackEngineChange('yt-dlp')
    })
    await expect.poll(() => app.electronApp.evaluate(
      () => globalThis.__ytDlpPlaybackResolvers.length
    )).toBe(1)

    await watchView.evaluate(async (view) => {
      await view.handlePlaybackEngineChange('built-in')
      window.__secondEngineSwitch = view.handlePlaybackEngineChange('yt-dlp')
    })
    expect(await app.electronApp.evaluate(
      () => globalThis.__ytDlpPlaybackResolvers.length
    )).toBe(1)

    await app.electronApp.evaluate(() => {
      globalThis.__ytDlpPlaybackResolvers.shift()({
        isLive: true,
        liveStatus: 'is_live',
        hlsManifestUrl: 'https://example.invalid/shared.m3u8',
        formats: [],
        duration: null,
        version: 'shared'
      })
    })
    await page.evaluate(() => Promise.all([
      window.__firstEngineSwitch,
      window.__secondEngineSwitch
    ]))
    expect(await watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      builtInManifest: view.builtInPlaybackSource.manifestSrc,
      manifest: view.manifestSrc,
      pending: view.ytDlpStreamsPending,
      version: view.activePlaybackEngineVersion
    }))).toEqual({
      activeEngine: 'yt-dlp',
      builtInManifest,
      manifest: 'https://example.invalid/shared.m3u8',
      pending: false,
      version: 'shared'
    })
  })

  test('preloads the configured number of upcoming yt-dlp recommendations', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ytDlpPreloadCalls = []
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', (_event, videoId) => {
        globalThis.__ytDlpPreloadCalls.push(videoId)
        return { error: 'expected test extraction failure' }
      })
    })

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      view.recommendedVideos = [
        { videoId: 'nextvideo01', title: 'First recommendation' },
        { videoId: 'nextvideo02', title: 'Second recommendation' },
        { videoId: 'nextvideo03', title: 'Third recommendation' }
      ]
      await view.$store.dispatch('updateYtDlpPreloadCount', 2)
      await view.$store.dispatch('updateYtDlpPreloadEnabled', true)
      await view.$store.dispatch('updateVideoPlaybackEngine', 'yt-dlp')
    })

    await expect.poll(() => app.electronApp.evaluate(() => [
      ...new Set(globalThis.__ytDlpPreloadCalls.filter(videoId => videoId.startsWith('nextvideo')))
    ])).toEqual(['nextvideo01', 'nextvideo02'])
  })

  test('an IP-blocked playback fallback retries yt-dlp with its default clients', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://example.invalid/rejected.m3u8', route => route.fulfill({
      contentType: 'text/html',
      body: '<html>expired</html>'
    }))
    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ytDlpIpBlockFallbackCalls = 0
      globalThis.__ytDlpIpBlockFallbackDefaultClients = []
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', (_event, _videoId, useDefaultClients) => {
        globalThis.__ytDlpIpBlockFallbackCalls++
        globalThis.__ytDlpIpBlockFallbackDefaultClients.push(useDefaultClients)
        return globalThis.__ytDlpIpBlockFallbackCalls <= 2
          ? {
              isLive: true,
              liveStatus: 'is_live',
              hlsManifestUrl: 'https://example.invalid/rejected.m3u8',
              formats: [],
              duration: null,
              version: 'test'
            }
          : { error: 'ENOENT' }
      })
    })

    await openMockedVideo(page)
    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      view.ipBlockDetectedInCurrentChain = true
      view.playbackEngineFallbackAttemptedForCurrentVideo = true
      view.playbackEngineFallbackTarget = 'yt-dlp'
      view.runIpBlockRecoveryScriptAndReload = async () => false
      await view.applyYtDlpPlaybackSource(view.videoLoadGeneration, view.videoId)
    })

    await expect.poll(() => app.electronApp.evaluate(() => globalThis.__ytDlpIpBlockFallbackCalls)).toBe(3)
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpIpBlockFallbackDefaultClients)).toEqual([false, true, true])
    await expect(page.locator('.toast', {
      hasText: 'The preferred yt-dlp clients could not provide playable streams'
    })).toHaveCount(1)
    expect(await watchView.evaluate((view) => ({
      ipBlockDetected: view.ipBlockDetectedInCurrentChain,
      fallbackAttempted: view.playbackEngineFallbackAttemptedForCurrentVideo,
      fallbackTarget: view.playbackEngineFallbackTarget
    }))).toEqual({
      ipBlockDetected: true,
      fallbackAttempted: true,
      fallbackTarget: null
    })

    expect(await watchView.evaluate(async (view) => {
      let recoveryCalls = 0
      view.ipBlockDetectedInCurrentChain = true
      view.playbackEngineFallbackTarget = 'yt-dlp'
      view.extractYtDlpPlaybackSource = async () => false
      view.runIpBlockRecoveryScriptAndReload = async () => {
        recoveryCalls++
        return true
      }
      await view.applyYtDlpPlaybackSource(view.videoLoadGeneration, view.videoId)
      return recoveryCalls
    })).toBe(1)
  })

  test('retries yt-dlp with its default clients for a limited live DVR manifest', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route(/^https:\/\/example\.invalid\/.*\.m3u8$/, route => route.fulfill({
      contentType: 'application/x-mpegURL',
      body: '#EXTM3U\n'
    }))
    await openMockedVideo(page)

    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ytDlpLiveDvrFallbackDefaultClients = []
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', (_event, _videoId, useDefaultClients) => {
        globalThis.__ytDlpLiveDvrFallbackDefaultClients.push(useDefaultClients)
        return {
          isLive: true,
          liveStatus: 'is_live',
          hlsManifestUrl: useDefaultClients
            ? 'https://example.invalid/playlist_type/DVR/full.m3u8'
            : 'https://example.invalid/manifest_duration/30/limited.m3u8',
          formats: [],
          duration: null,
          version: 'test'
        }
      })
    })

    const watchView = await watchViewHandle(page)
    await watchView.evaluate((view) => view.handlePlaybackEngineChange('yt-dlp'))

    expect(await app.electronApp.evaluate(
      () => globalThis.__ytDlpLiveDvrFallbackDefaultClients
    )).toEqual([false, true])
    expect(await watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      manifest: view.manifestSrc
    }))).toEqual({
      activeEngine: 'yt-dlp',
      manifest: 'https://example.invalid/playlist_type/DVR/full.m3u8'
    })

    // A stream error can cause a fresh extraction for the same video. The retry
    // still uses the default clients, but should not repeat the same notification.
    await watchView.evaluate((view) => view.extractYtDlpPlaybackSource(
      view.videoLoadGeneration,
      view.videoId,
      view.playbackEngineSwitchGeneration
    ))
    expect(await app.electronApp.evaluate(
      () => globalThis.__ytDlpLiveDvrFallbackDefaultClients
    )).toEqual([false, true, false, true])
    await expect(page.locator('.toast', {
      hasText: 'The preferred yt-dlp clients could not provide playable streams'
    })).toHaveCount(1)
  })

  for (const scenario of ['preferred clients', 'default clients', 'authenticated default clients', 'anonymous extraction fails']) {
    test(`retries a limited authenticated live manifest without cookies: ${scenario}`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await page.route(/^https:\/\/example\.invalid\/.*\.m3u8$/, route => route.fulfill({
        contentType: 'application/x-mpegURL',
        body: '#EXTM3U\n'
      }))
      await openMockedVideo(page)
      await page.evaluate(async () => {
        const store = window.$store
        await store.dispatch('updateYtDlpPlaybackAuthMode', 'browser')
        await store.dispatch('updateYtDlpPlaybackCookiesBrowser', 'firefox')
        await store.dispatch('updateYtDlpPlaybackAlwaysUseCookies', true)
      })
      await app.electronApp.evaluate(({ ipcMain }, scenario) => {
        globalThis.__premiereAuthenticationCalls = []
        ipcMain.removeHandler('yt-dlp-get-playback-info')
        ipcMain.handle('yt-dlp-get-playback-info', (_event, _videoId, useDefaultClients, useAuthentication) => {
          globalThis.__premiereAuthenticationCalls.push({ useDefaultClients, useAuthentication })
          if (scenario === 'default clients' && !useDefaultClients) {
            return { error: 'Preferred clients could not extract formats' }
          }
          if (['authenticated default clients', 'anonymous extraction fails'].includes(scenario) && !useAuthentication) {
            return { error: 'This live stream requires authentication' }
          }
          return {
            isLive: true,
            liveStatus: 'is_live',
            hlsManifestUrl: !useAuthentication || (scenario === 'authenticated default clients' && useDefaultClients)
              ? 'https://example.invalid/manifest_duration/3600/full.m3u8'
              : 'https://example.invalid/manifest_duration/30/limited.m3u8',
            formats: [],
            duration: null,
            version: 'test'
          }
        })
      }, scenario)
      const view = await watchViewHandle(page)
      await view.evaluate(view => view.handlePlaybackEngineChange('yt-dlp'))
      const calls = [{ useDefaultClients: false, useAuthentication: true }]
      calls.push({ useDefaultClients: true, useAuthentication: true })
      if (scenario !== 'authenticated default clients') calls.push({ useDefaultClients: true, useAuthentication: false })
      expect(await app.electronApp.evaluate(() => globalThis.__premiereAuthenticationCalls)).toEqual(calls)
      const retainedLimitedStream = scenario === 'anonymous extraction fails'
      expect(await view.evaluate(view => view.manifestSrc)).toBe(retainedLimitedStream
        ? 'https://example.invalid/manifest_duration/30/limited.m3u8'
        : 'https://example.invalid/manifest_duration/3600/full.m3u8')
      await expect(page.locator('.shaka-seek-bar-container')).toHaveCount(retainedLimitedStream ? 0 : 1)
    })
  }

  for (const incompletePreferredSource of [true, false]) {
    test(`retains the complete limited live source when preferred clients are incomplete: ${incompletePreferredSource}`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await page.route(/^https:\/\/example\.invalid\/.*\.m3u8$/, route => route.fulfill({
        contentType: 'application/x-mpegURL',
        body: '#EXTM3U\n'
      }))
      await openMockedVideo(page)
      await page.evaluate(async () => {
        const store = window.$store
        await store.dispatch('updateYtDlpPlaybackAuthMode', 'browser')
        await store.dispatch('updateYtDlpPlaybackCookiesBrowser', 'firefox')
        await store.dispatch('updateYtDlpPlaybackAlwaysUseCookies', true)
      })
      await app.electronApp.evaluate(({ ipcMain }, incompletePreferredSource) => {
        globalThis.__limitedSourceAuthenticationCalls = []
        ipcMain.removeHandler('yt-dlp-get-playback-info')
        ipcMain.handle('yt-dlp-get-playback-info', (_event, _videoId, useDefaultClients, useAuthentication) => {
          globalThis.__limitedSourceAuthenticationCalls.push({ useDefaultClients, useAuthentication })
          if (!useAuthentication) return { error: 'This live stream requires authentication' }
          return {
            isLive: true,
            liveStatus: 'is_live',
            hlsManifestUrl: `https://example.invalid/manifest_duration/30/${useDefaultClients ? 'default' : 'preferred'}.m3u8`,
            incomplete: useDefaultClients ? !incompletePreferredSource : incompletePreferredSource,
            formats: [],
            duration: null,
            version: 'test'
          }
        })
      }, incompletePreferredSource)
      const view = await watchViewHandle(page)
      await view.evaluate(view => view.handlePlaybackEngineChange('yt-dlp'))
      expect(await app.electronApp.evaluate(() => globalThis.__limitedSourceAuthenticationCalls)).toEqual([
        { useDefaultClients: false, useAuthentication: true },
        { useDefaultClients: true, useAuthentication: true },
        { useDefaultClients: true, useAuthentication: false }
      ])
      expect(await view.evaluate(view => view.manifestSrc)).toBe(
        `https://example.invalid/manifest_duration/30/${incompletePreferredSource ? 'default' : 'preferred'}.m3u8`
      )
      await expect(page.locator('.shaka-seek-bar-container')).toHaveCount(0)
    })
  }

  test('treats yt-dlp live status as live and does not cache its HLS source', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://example.invalid/live-status.m3u8', route => route.fulfill({
      contentType: 'application/x-mpegURL',
      body: '#EXTM3U\n'
    }))
    await openMockedVideo(page)

    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ytDlpLiveStatusCalls = 0
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', () => {
        globalThis.__ytDlpLiveStatusCalls++
        return {
          isLive: false,
          liveStatus: 'is_live',
          hlsManifestUrl: 'https://example.invalid/live-status.m3u8',
          formats: [{
            url: 'https://example.invalid/live-segment.mp4?expire=4102444800',
            protocol: 'https',
            vcodec: null,
            acodec: null
          }],
          duration: null,
          storyboardVtt: null,
          title: 'Live video',
          version: 'test'
        }
      })
    })

    const watchView = await watchViewHandle(page)
    await watchView.evaluate((view) => view.handlePlaybackEngineChange('yt-dlp'))
    expect(await watchView.evaluate((view) => view.isLive)).toBe(true)

    await watchView.evaluate((view) => view.extractYtDlpPlaybackSource(
      view.videoLoadGeneration,
      view.videoId,
      view.playbackEngineSwitchGeneration
    ))
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpLiveStatusCalls)).toBe(2)
  })

  test('falls back to yt-dlp when the built-in live source has no manifest', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://example.invalid/live.m3u8', route => route.fulfill({
      contentType: 'application/x-mpegURL',
      body: '#EXTM3U\n'
    }))
    await page.route('https://example.invalid/rejected.mp4', route => route.fulfill({ status: 403 }))
    await openMockedVideo(page)

    await app.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', () => ({
        isLive: true,
        liveStatus: 'is_live',
        hlsManifestUrl: 'https://example.invalid/live.m3u8',
        formats: [{
          formatId: '18',
          url: 'https://example.invalid/rejected.mp4',
          protocol: 'https',
          ext: 'mp4',
          vcodec: 'avc1',
          acodec: 'mp4a',
          width: 640,
          height: 360,
          fps: 30,
          bitrate: 500_000,
          audioSampleRate: 44_100,
          audioChannels: 2,
          language: null,
          formatNote: null,
          dynamicRange: 'SDR',
          availableAt: null
        }],
        duration: null,
        version: 'test'
      }))
    })

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      view.isLoading = false
      view.errorMessage = 'Previous playback source failed'
      view.videoTitle = 'Active live stream'
      view.isLive = true
      view.manifestSrc = null
      view.legacyFormats = []
      view.activeFormat = 'legacy'
      view.activePlaybackEngine = 'built-in'
      await view.applyYtDlpPlaybackSource(view.videoLoadGeneration, view.videoId)
      await view.$nextTick()
    })

    await expect(page.locator(`${activeTab} .videoTitle`)).toHaveText('Active live stream')
    expect(await watchView.evaluate((view) => ({
      manifestSrc: view.manifestSrc,
      activeFormat: view.activeFormat,
      activePlaybackEngine: view.activePlaybackEngine,
      activePlaybackEngineVersion: view.activePlaybackEngineVersion,
      errorMessage: view.errorMessage,
      legacyFormats: view.legacyFormats,
      playerReady: view.playerReady,
      ytDlpStreamsPending: view.ytDlpStreamsPending
    }))).toEqual({
      manifestSrc: 'https://example.invalid/live.m3u8',
      activeFormat: 'dash',
      activePlaybackEngine: 'yt-dlp',
      activePlaybackEngineVersion: 'test',
      errorMessage: null,
      legacyFormats: [],
      playerReady: true,
      ytDlpStreamsPending: false
    })
  })

  test('uses yt-dlp for a recently ended live stream after the built-in source fails', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await routePostLiveMedia(page)
    await routePostLivePlayer(page, { dashManifestUrl: 'https://example.invalid/rejected-post-live.mpd' })
    let rejectedManifestRequests = 0
    await page.route(/^https:\/\/example\.invalid\/api\/manifest\/dash\//, route => {
      rejectedManifestRequests++
      return route.fulfill({ status: 403 })
    })

    await mockPostLiveYtDlp(app)
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateVideoPlaybackEngine', 'built-in')
      await store.dispatch('updatePauseOnStreamRecovery', true)
    })

    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator(`${activeTab} .videoTitle`)).toBeVisible()

    const watchView = await watchViewHandle(page)
    await expect.poll(() => watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      errorMessage: view.errorMessage,
      postLive: view.isPostLiveDvr,
      streamsPending: view.ytDlpStreamsPending
    })), { timeout: 15_000 }).toEqual({
      activeEngine: 'yt-dlp',
      errorMessage: null,
      postLive: true,
      streamsPending: false
    })

    expect(rejectedManifestRequests).toBeGreaterThan(0)
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpPostLiveCalls)).toBe(1)
    // With Pause on Stream Recovery, a failed initial load still autoplays the fallback, but explains it.
    await waitForPlayback(page)
    await expect(page.locator(`${activeTab} .streamRecoveryNotice`)).toContainText('trying yt-dlp instead')

    await page.getByRole('button', { name: 'Change Media Formats' }).click()
    const prompt = page.getByRole('dialog', { name: 'Change Media Formats' })
    await expect(prompt.getByRole('button', { name: 'yt-dlp' })).toBeEnabled()
    await expect(prompt.getByRole('button', { name: 'Built-in' })).toBeEnabled()
  })

  test('uses yt-dlp for a recently ended live stream without built-in manifests', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await routePostLiveMedia(page)
    await routePostLivePlayer(page, {})
    await mockPostLiveYtDlp(app)
    await page.evaluate(() => window.$store.dispatch('updateVideoPlaybackEngine', 'built-in'))

    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator(`${activeTab} .videoTitle`)).toBeVisible()

    const watchView = await watchViewHandle(page)
    await expect.poll(() => watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      errorMessage: view.errorMessage,
      postLive: view.isPostLiveDvr,
      streamsPending: view.ytDlpStreamsPending
    })), { timeout: 15_000 }).toEqual({
      activeEngine: 'yt-dlp',
      errorMessage: null,
      postLive: true,
      streamsPending: false
    })
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpPostLiveCalls)).toBe(1)
    await waitForPlayback(page)
  })

  test('reports missing formats for a recently ended live stream without manifests or fallback', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await routePostLivePlayer(page, {})
    await mockPostLiveYtDlp(app)
    await page.evaluate(async () => {
      await window.$store.dispatch('updateVideoPlaybackEngine', 'built-in')
      await window.$store.dispatch('updatePlaybackEngineFallback', false)
    })

    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    await expect(page.locator(`${activeTab} .videoTitle`)).toBeVisible()
    await expect(page.locator(activeTab).getByText('This video is unavailable because of missing formats')).toBeVisible()
    expect(await app.electronApp.evaluate(() => globalThis.__ytDlpPostLiveCalls)).toBe(0)
  })

  test('does not override a manual built-in selection when its live source is unavailable', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    const result = await watchView.evaluate(async (view) => {
      view.isLive = true
      view.isPostLiveDvr = false
      view.manifestSrc = null
      view.legacyFormats = []
      view.activePlaybackEngine = 'built-in'
      view.playbackEngineFallbackTarget = 'built-in'
      view.ytDlpStreamsPending = true
      view.errorMessage = null

      await view.applyYtDlpPlaybackSource(view.videoLoadGeneration, view.videoId)

      return {
        activeEngine: view.activePlaybackEngine,
        fallbackTarget: view.playbackEngineFallbackTarget,
        pending: view.ytDlpStreamsPending,
        errorMessage: view.errorMessage
      }
    })

    expect(result).toEqual({
      activeEngine: 'built-in',
      fallbackTarget: 'built-in',
      pending: false,
      errorMessage: 'This video is unavailable because of missing formats. This can happen due to country unavailability.'
    })
  })

  test('balances normal watch chat margins', { tag: '@scale' }, async ({ app, page, attachScreenshot, uiScale }) => {
    await setWindowSize(app, page, { width: 1800, height: 1000 })
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      const chat = new EventTarget()
      chat.is_replay = true
      chat.on = (event, listener) => chat.addEventListener(event, listener)
      chat.once = (event, listener) => chat.addEventListener(event, listener, { once: true })
      chat.off = (event, listener) => chat.removeEventListener(event, listener)
      chat.start = () => {}
      chat.stop = () => {}

      view.$store.commit('setHideLiveChatReplay', false)
      view.liveChat = chat
      view.liveChatIsReplay = true
      view.liveChatOpen = true
      view.useTheatreMode = false
      await view.$nextTick()
    })

    const watch = page.locator(`${activeTab} .videoLayout`)
    const player = watch.locator('.videoPlayer').first()
    const chat = watch.locator('.watchVideoPlaylist').filter({ hasText: 'Live Chat Replay' })
    const info = watch.locator('.watchVideoInfo')
    await expect(chat).toBeVisible()
    await expect.poll(async () => {
      const playerBox = await player.boundingBox()
      const chatBox = await chat.boundingBox()
      const viewportWidth = await page.evaluate(() => innerWidth)
      return Math.abs(chatBox.x - playerBox.x - playerBox.width - (viewportWidth - chatBox.x - chatBox.width))
    }).toBeLessThan(3)
    const playerBox = await player.boundingBox()
    const infoBox = await info.boundingBox()
    expect(Math.abs(playerBox.x - infoBox.x)).toBeLessThan(2)
    expect(Math.abs(playerBox.x + playerBox.width - infoBox.x - infoBox.width)).toBeLessThan(2)
    await attachScreenshot(`Normal watch chat at ${uiScale}% UI scale`)

    await watchView.evaluate(async (view) => {
      view.useTheatreMode = true
      await view.$nextTick()
    })
    await expect.poll(async () => {
      const playerBox = await player.boundingBox()
      const chatBox = await chat.boundingBox()
      return chatBox.y >= playerBox.y + playerBox.height - 2
    }).toBe(true)

    await watchView.evaluate(async (view) => {
      view.useTheatreMode = false
      await view.$nextTick()
    })
    await setWindowSize(app, page, { width: 1000, height: 780 })
    await expect.poll(async () => {
      const infoBox = await info.boundingBox()
      const chatBox = await chat.boundingBox()
      return chatBox.y >= infoBox.y + infoBox.height - 2
    }).toBe(true)
    expect(await watch.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  })
})
