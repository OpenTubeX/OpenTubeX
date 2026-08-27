import crypto from 'node:crypto'
import { goTo, sel, setPlayerFullscreen, setWindowSize, test, expect } from '../../helpers/app.mjs'
import { activeTab, findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { demoPlayerResponse } from '../../helpers/media.mjs'

// These used to live in the network suite, gated on the live API. They all use
// "Me at the zoo", whose page and comment pages are recorded, so they run
// against the mocked watch page and the local demo video instead. See
// e2e/README.md, "Playing a video without YouTube".

// yt-dlp isn't installed in the test environment, so its extraction attempt
// only costs time and leaves a fallback toast over the page. The migration
// marker stops the store from switching the engine back on launch.
const WATCH_PAGE_SEED = {
  videoPlaybackEngine: 'built-in',
  ytDlpPlaybackEngineDefaultMigration: true
}

test.use({ seed: { settings: WATCH_PAGE_SEED } })

test('offers a YouTube link action in the watch tab context menu', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  await page.locator('.tab.active').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })).toBeVisible()
})

test('uses the stored watch route for a dev-server tab link action', async ({ app, page }) => {
  const watchTab = await page.evaluate(() => window.ftElectron.tabs.create({
    url: 'http://localhost:9080/#/watch/jNQXAC9IVRw',
    title: 'Dev watch tab',
    makeActive: false,
    lazyLoad: true
  }))

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.ftElectron.tabs.getState())
    return state.tabs.find(tab => tab.id === watchTab.id)?.route.fullPath
  }).toBe('/watch/jNQXAC9IVRw')
  await page.locator(`.tab[data-tab-id="${watchTab.id}"]`).click({ button: 'right' })
  const copyYouTubeLink = page.getByRole('menuitem', { name: 'Copy YouTube Link', exact: true })
  await expect(copyYouTubeLink).toBeVisible()
  await copyYouTubeLink.click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('https://youtu.be/jNQXAC9IVRw')
})

test('shows age-restricted and unlisted badges below the video title', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.route(/\/youtubei\/v1\/player/, (route, request) => {
    const videoId = JSON.parse(request.postData() ?? '{}').videoId ?? 'jNQXAC9IVRw'
    const response = demoPlayerResponse(videoId)
    response.microformat.playerMicroformatRenderer.isFamilySafe = false
    response.microformat.playerMicroformatRenderer.isUnlisted = true
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    })
  })

  await openMockedVideo(page)

  const videoInfo = page.locator('.infoArea .watchVideoInfo')
  const ageRestrictedBadge = videoInfo.locator('.ageRestrictedBadge')
  const unlistedBadge = videoInfo.locator('.unlistedBadge')
  await expect(videoInfo.locator('.videoBadges')).toHaveCount(1)
  await expect(ageRestrictedBadge).toHaveText('Age restricted')
  await expect(ageRestrictedBadge.locator('[data-icon="user-lock"]')).toBeVisible()
  await expect(unlistedBadge).toHaveText('Unlisted')
  await expect(unlistedBadge.locator('[data-icon="eye-slash"]')).toBeVisible()

  const [badgeBounds, titleBounds] = await Promise.all([
    ageRestrictedBadge.boundingBox(),
    videoInfo.locator('.videoTitle').boundingBox()
  ])
  expect(badgeBounds).not.toBeNull()
  expect(titleBounds).not.toBeNull()
  expect(badgeBounds.y).toBeGreaterThanOrEqual(titleBounds.y + titleBounds.height)
})

for (const { name, options, expectedCount } of [
  { name: 'hides transcript actions without captions', options: {}, expectedCount: 0 },
  {
    name: 'shows transcript actions with captions',
    options: { captionCueSettings: 'align:center' },
    expectedCount: 1
  }
]) {
  test(name, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, options)
    await openMockedVideo(page)

    await expect(page.locator('.infoArea .watchVideoInfo')
      .getByRole('button', { name: 'Show transcript' }))
      .toHaveCount(expectedCount)
    await expect(page.locator('.fullscreenActions .fullscreenTranscriptToggle'))
      .toHaveCount(expectedCount)
  })
}

test.describe('fullscreen ambient mode', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        uiScale: 95
      }
    }
  })

  test('stays off without bars and centers letterbox glow beside a dock', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateAmbientMode', true)
    })

    await setPlayerFullscreen(page, true)
    const player = page.locator('.ftVideoPlayer')
    const ambient = player.locator('.ambientFullscreenCanvas')
    await expect.poll(() => ambient.evaluate(element => Number(getComputedStyle(element).opacity)))
      .toBe(0)

    await video.evaluate(async (element) => {
      const source = document.createElement('canvas')
      source.width = 190
      source.height = 90
      source.getContext('2d').fillStyle = '#ff0000'
      source.getContext('2d').fillRect(0, 0, source.width, source.height)

      const stream = source.captureStream(10)
      element.srcObject = stream
      await element.play()
      window.__ambientModeTestMedia = { source, stream }
    })
    await expect.poll(() => video.evaluate(element => [element.videoWidth, element.videoHeight]))
      .toEqual([190, 90])

    await expect.poll(() => ambient.evaluate(element => Number(getComputedStyle(element).opacity)))
      .toBeGreaterThan(0)
    await expect.poll(() => ambient.evaluate((element) => {
      const [red, green, blue, alpha] = element.getContext('2d').getImageData(40, 22, 1, 1).data
      return red > 200 && green < 20 && blue < 20 && alpha === 255
    })).toBe(true)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenMetadata(true)
    })
    await expect(page.locator('.fullscreenMetadataOverlay.open')).toBeVisible()
    await expect.poll(async () => {
      const [playerBounds, videoBounds] = await Promise.all([
        player.boundingBox(),
        video.boundingBox()
      ])
      return playerBounds.width - videoBounds.width
    }).toBeGreaterThan(100)
    await expect.poll(async () => {
      const [ambientBounds, videoBounds] = await Promise.all([
        ambient.boundingBox(),
        video.boundingBox()
      ])
      const ambientCenter = ambientBounds.x + ambientBounds.width / 2
      const videoCenter = videoBounds.x + videoBounds.width / 2
      return Math.abs(ambientCenter - videoCenter)
    }).toBeLessThanOrEqual(1)

    await player.evaluate((element) => {
      for (const overlay of element.querySelectorAll('.shaka-controls-container, .playerFullscreenTitleOverlay')) {
        overlay.style.visibility = 'hidden'
      }
    })
    const screenshot = await player.screenshot()
    const letterboxPixel = await page.evaluate(async (base64) => {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()

      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return [...context.getImageData(Math.floor(image.width / 2), 20, 1, 1).data]
    }, screenshot.toString('base64'))

    expect(letterboxPixel[0]).toBeGreaterThan(40)
    expect(letterboxPixel[0]).toBeGreaterThan(letterboxPixel[1] * 2)
    expect(letterboxPixel[0]).toBeGreaterThan(letterboxPixel[2] * 2)
  })
})

test('shows the restricted playback setup hint until an authenticated retry is available', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.route('https://example.invalid/restricted.mp4?expire=4102444800', route => route.fulfill({ body: 'video' }))
  await openMockedVideo(page)

  const watchView = await watchViewHandle(page)
  await watchView.evaluate(async (view) => {
    view.isLoading = false
    view.playbackEngineFallbackTarget = 'built-in'
    view.setRestrictedPlaybackError('age')
    await view.$nextTick()
  })

  await expect(page.getByText(
    'Configure cookies in Settings → External Software → Restricted Video Authentication.'
  )).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpPlaybackAuthMode', 'browser')
    await store.dispatch('updateYtDlpPlaybackCookiesBrowser', 'firefox')
  })
  await app.electronApp.evaluate(({ ipcMain }) => {
    globalThis.__restrictedPlaybackCalls = []
    ipcMain.removeHandler('yt-dlp-get-playback-info')
    ipcMain.handle(
      'yt-dlp-get-playback-info',
      (_event, _videoId, useDefaultClients, useAuthentication) => {
        globalThis.__restrictedPlaybackCalls.push({ useDefaultClients, useAuthentication })
        return {
          isLive: false,
          liveStatus: 'not_live',
          hlsManifestUrl: null,
          formats: [{
            formatId: '18',
            url: 'https://example.invalid/restricted.mp4?expire=4102444800',
            manifestUrl: null,
            protocol: 'https',
            ext: 'mp4',
            container: 'mp4_dash',
            vcodec: 'avc1.42001E',
            acodec: 'mp4a.40.2',
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
          title: 'Restricted video',
          version: 'test'
        }
      }
    )
  })
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
    'Configure cookies in Settings → External Software → Restricted Video Authentication.'
  )).toHaveCount(0)
  const retry = page.getByRole('button', { name: 'Try with configured cookies' })
  await expect(retry).toBeVisible()
  await retry.click()

  await expect.poll(() => app.electronApp.evaluate(
    () => globalThis.__restrictedPlaybackCalls
  )).toEqual([{ useDefaultClients: false, useAuthentication: true }])
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
  )).toEqual([{ useDefaultClients: false, useAuthentication: true }])
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)
})

test.describe('Shorts transcript navigation', () => {
  const SHORTS_CHANNEL_ID = 'UC-transcript-shorts'
  const CAPTIONED_SHORT_IDS = ['captioned-short-1', 'captioned-short-2']
  const CAPTIONLESS_SHORT_ID = 'captionless-short'
  const shorts = [...CAPTIONED_SHORT_IDS, CAPTIONLESS_SHORT_ID].map((videoId, index) => ({
    type: 'video',
    videoId,
    title: `Transcript Short ${index + 1}`,
    author: 'Transcript Shorts',
    authorId: SHORTS_CHANNEL_ID,
    published: CAPTIONED_SHORT_IDS.length + 1 - index,
    isShort: true,
    lengthSeconds: '',
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/frame0.jpg?selected=1`
  }))

  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        useCustomShortsPlayer: true,
        useQuickPlaybackSpeedBar: true,
        fetchSubscriptionsAutomatically: false
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{
          id: SHORTS_CHANNEL_ID,
          name: 'Transcript Shorts',
          thumbnail: ''
        }]
      }],
      subscriptionCache: [{
        _id: SHORTS_CHANNEL_ID,
        shorts,
        shortsTimestamp: new Date().toISOString()
      }]
    }
  })

  test('keeps the current Short from expanding when YouTube-style Shorts are disabled', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', 95)
    })
    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    await waitForPlayback(page)

    const player = page.locator('.ftVideoPlayer')
    await expect(player).toHaveClass(/shortsPlayer/)
    const shortsBounds = await player.boundingBox()
    expect(shortsBounds).not.toBeNull()

    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    const toggle = page.getByRole('checkbox', { name: 'Use YouTube-style Shorts' })
    await expect(toggle).toBeChecked()
    await page.locator('label.switch-label')
      .filter({ hasText: 'Use YouTube-style Shorts' })
      .click()
    await expect(toggle).not.toBeChecked()
    await expect(player).toHaveClass(/shortsPlayer/)

    const bounds = await player.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds.width).toBeLessThanOrEqual(shortsBounds.width + 1)

    await page.locator('.settingsWindow').getByRole('button', { name: 'Close' }).click()
    await page.locator('.shortsNavigationButton').last().click()
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[1]}\\?short=true`))
    await waitForPlayback(page)
    await expect(player).not.toHaveClass(/shortsPlayer/)
  })

  test('shows quick playback speeds near the pointer without covering the seek preview', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    const video = await waitForPlayback(page)

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const controlPanel = player.locator('.shaka-controls-button-panel')
    const playbackRateBar = controlPanel.locator('.ft-quick-playback-rate-bar')
    const seekBar = player.locator('.shaka-seek-bar-container')
    const opacity = () => controlPanel.evaluate(element => Number(getComputedStyle(element).opacity))

    await expect(playbackRateBar).toHaveCount(1)
    await expect(playbackRateBar.getByRole('button')).toHaveCount(9)

    const playerBounds = await player.boundingBox()
    expect(playerBounds).not.toBeNull()

    await player.dispatchEvent('mousemove', {
      clientX: playerBounds.x + playerBounds.width / 2,
      clientY: playerBounds.y + 80
    })
    await expect.poll(opacity).toBe(0)

    let rateBarBounds = await playbackRateBar.boundingBox()
    expect(rateBarBounds).not.toBeNull()
    await player.dispatchEvent('mousemove', {
      clientX: rateBarBounds.x + rateBarBounds.width / 2,
      clientY: rateBarBounds.y - 24
    })
    await expect.poll(opacity).toBeGreaterThan(0.2)
    expect(await opacity()).toBeLessThan(0.5)

    rateBarBounds = await playbackRateBar.boundingBox()
    expect(rateBarBounds).not.toBeNull()
    await player.dispatchEvent('mousemove', {
      clientX: rateBarBounds.x + rateBarBounds.width / 2,
      clientY: rateBarBounds.y - 6
    })
    await expect.poll(opacity).toBeGreaterThan(0.75)

    rateBarBounds = await playbackRateBar.boundingBox()
    expect(rateBarBounds).not.toBeNull()
    await playbackRateBar.dispatchEvent('mousemove', {
      clientX: rateBarBounds.x + rateBarBounds.width / 2,
      clientY: rateBarBounds.y + rateBarBounds.height / 2
    })
    await expect.poll(opacity).toBe(1)
    await attachScreenshot('Shorts quick playback speed bar')

    const playbackRateButton = playbackRateBar.getByRole('button', { name: '1.25x', exact: true })
    await playbackRateButton.click()
    await expect(playbackRateButton).toBeFocused()
    await expect.poll(() => video.evaluate(element => element.playbackRate)).toBe(1.25)

    await seekBar.hover()
    await expect.poll(opacity).toBe(0)
    await expect(playbackRateButton).not.toBeFocused()
    expect(await seekBar.evaluate(element => getComputedStyle(element).zIndex)).toBe('3')
    expect(await controlPanel.evaluate(element => getComputedStyle(element).zIndex)).toBe('2')
  })

  test('preserves the panel until navigation reaches a captionless Short', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, {
      captionCueSettings: 'align:center',
      captionVideoIds: CAPTIONED_SHORT_IDS
    })
    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    await waitForPlayback(page)

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const transcriptButton = page.locator('.shortsComponentAction')
      .filter({ hasText: 'Transcript' })
      .getByRole('button')
    const transcriptPanel = page.locator('.shortsAuxPanelTarget .watchVideoTranscript')
    const next = page.locator('.shortsNavigationButton').last()

    await expect(player).toBeVisible()
    await transcriptButton.click()
    await expect(transcriptPanel).toBeVisible()

    await next.click()
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[1]}\\?short=true`))
    await expect(transcriptPanel).toBeVisible()
    await expect(transcriptButton).toHaveAttribute('aria-pressed', 'true')

    await page.waitForTimeout(350)
    await next.click()
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONLESS_SHORT_ID}\\?short=true`))
    await expect(transcriptPanel).toHaveCount(0)
    await expect(transcriptButton).toHaveCount(0)
  })

  test('docks, scrolls, and clamps video information across Shorts navigation', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await setWindowSize(app, page, { width: 1325, height: 760 })
    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    await waitForPlayback(page)
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      const lines = Array.from({ length: 80 }, (_, index) => `Description line ${index + 1}`)
      view.videoDescription = lines.join('\n')
      view.videoDescriptionHtml = lines.join('<br>')
      view.toggleShortsMetadata()
      await view.$nextTick()
    })

    const panel = page.locator('.shortsAuxPanel')
    const scroller = panel.locator('.shortsAuxPanelTarget')
    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    await expect(panel).toHaveClass(/shortsAuxPanelOpen/)
    await expect.poll(async () => {
      const [panelBounds, playerBounds] = await Promise.all([
        panel.boundingBox(),
        player.boundingBox()
      ])
      const bottomDelta = Math.abs(
        panelBounds.y + panelBounds.height - playerBounds.y - playerBounds.height
      )
      const topDelta = Math.abs(panelBounds.y - playerBounds.y)
      return Math.max(bottomDelta, topDelta)
    }).toBeLessThanOrEqual(1)
    await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(panel.locator('.os-scrollbar-vertical')).toHaveCount(1)
    await expect.poll(() => scroller.evaluate(element => {
      return element.scrollHeight - element.clientHeight
    })).toBeGreaterThan(100)

    const initialScrollTop = await scroller.evaluate(element => element.scrollTop)
    const pointer = await scroller.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return {
        x: bounds.left + bounds.width / 2,
        y: Math.min(bounds.bottom - 1, window.innerHeight - 1)
      }
    })
    await page.mouse.move(pointer.x, pointer.y)
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    expect(await scroller.evaluate((element, point) => {
      const hit = document.elementFromPoint(point.x, point.y)
      return element.contains(hit)
    }, pointer)).toBe(true)
    await page.mouse.wheel(0, 500)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop))
      .toBeGreaterThan(initialScrollTop)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => {
      const viewportBounds = element.getBoundingClientRect()
      const descriptionBounds = element.querySelector('.description').getBoundingClientRect()
      return {
        atScrollEnd: element.scrollHeight - element.clientHeight - element.scrollTop <= 1,
        renderedEndVisible: descriptionBounds.bottom <= viewportBounds.bottom + 1
      }
    })).toEqual({ atScrollEnd: true, renderedEndVisible: true })

    await setWindowSize(app, page, { width: 1326, height: 1012 })
    await expect.poll(() => scroller.evaluate(element => {
      const contentEnd = element.querySelector('.shortsAuxPanelContentEnd')
      const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
      const viewportBounds = element.getBoundingClientRect()
      const contentEndBounds = contentEnd.getBoundingClientRect()
      const maximumScrollTop = Math.max(0, contentEnd.offsetTop - element.clientHeight)
      const hasVerticalOverflow = maximumScrollTop > 1
      return {
        atRenderedEnd: maximumScrollTop === 0
          ? element.scrollTop <= 1
          : Math.abs(contentEndBounds.bottom - viewportBounds.bottom) <= 1,
        scrollbarMatchesOverflow:
          scrollbar?.classList.contains('os-scrollbar-visible') === hasVerticalOverflow,
        withinRenderedRange: element.scrollTop <= maximumScrollTop + 1
      }
    })).toEqual({
      atRenderedEnd: true,
      scrollbarMatchesOverflow: true,
      withinRenderedRange: true
    })
    await page.mouse.wheel(0, 500)
    await page.waitForTimeout(100)
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))

    await page.locator('.shortsNavigationButton').last().click()
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[1]}\\?short=true`))
    await waitForPlayback(page)
    await expect(panel).toHaveClass(/shortsAuxPanelOpen/)
    await expect.poll(() => scroller.evaluate(element => {
      const content = element.querySelector('.videoDescription')
      const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
      const viewportBounds = element.getBoundingClientRect()
      const contentBounds = content?.getBoundingClientRect()
      const maximumScrollTop = Math.max(
        0,
        (content?.offsetTop ?? 0) + (content?.offsetHeight ?? 0) - element.clientHeight
      )
      const hasVerticalOverflow = element.scrollHeight > element.clientHeight + 1
      return {
        atRenderedEnd: contentBounds != null &&
          (maximumScrollTop === 0
            ? element.scrollTop <= 1
            : Math.abs(contentBounds.bottom - viewportBounds.bottom) <= 1),
        horizontalOverflowHidden: getComputedStyle(element).overflowX === 'hidden' &&
          element.scrollWidth <= element.clientWidth + 1,
        scrollbarMatchesOverflow:
          scrollbar?.classList.contains('os-scrollbar-visible') === hasVerticalOverflow,
        withinRenderedRange: element.scrollTop <= maximumScrollTop + 1
      }
    })).toEqual({
      atRenderedEnd: true,
      horizontalOverflowHidden: true,
      scrollbarMatchesOverflow: true,
      withinRenderedRange: true
    })
  })

  test('keeps loading Shorts when another player keeps the shared caption factory alive', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionTranslations: true })

    const backgroundTab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/watch/background-captioned-video',
      title: 'Background captioned video',
      makeActive: false,
      preloadInBackground: true
    }))
    const backgroundContent = page.locator(`.tabContent[data-tab-id="${backgroundTab.id}"]`)
    const backgroundPlayer = backgroundContent.locator('.ftVideoPlayer')
    await expect(backgroundPlayer).toHaveCount(1, { timeout: 30_000 })
    await expect.poll(() => backgroundPlayer.evaluate(element => {
      return element.ui?.getControls().getPlayer().getAssetUri() ?? ''
    })).not.toBe('')

    await page.locator(sel.searchInput)
      .fill(`https://www.youtube.com/shorts/${CAPTIONED_SHORT_IDS[0]}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[0]}\\?short=true`))
    await waitForPlayback(page)

    const rendererErrors = []
    page.on('pageerror', error => rendererErrors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') rendererErrors.push(message.text())
    })

    await page.locator('.shortsNavigationButton').last().click()
    await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${CAPTIONED_SHORT_IDS[1]}\\?short=true`))
    await waitForPlayback(page)

    expect(rendererErrors.filter(error => (
      error.includes('getTextTracks') || error.includes('failed to render')
    ))).toEqual([])
  })
})

test('a background watch tab stays loading until its cached avatar is ready', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)

  await page.evaluate(() => {
    window.__backgroundWatchIconStates = []
    const record = () => {
      for (const tab of document.querySelectorAll('.tab')) {
        window.__backgroundWatchIconStates.push({
          id: tab.dataset.tabId,
          loading: tab.querySelector('.loadingDot') != null,
          avatar: tab.querySelector('.tabAvatar') != null,
          pageIcon: tab.querySelector('.tabPageIcon') != null
        })
      }
    }
    new MutationObserver(record).observe(
      document.querySelector('.tabsContainer'),
      { childList: true, subtree: true }
    )
  })

  const watchTab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/watch/jNQXAC9IVRw',
    title: 'Cached video',
    makeActive: false,
    preloadInBackground: true
  }))
  const tab = page.locator(`.tab[data-tab-id="${watchTab.id}"]`)

  await expect(tab.locator('.loadingDot')).toBeVisible()
  const avatarCached = await page.evaluate(async tabId => {
    const avatarBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUzZpk7I4HSAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg=='
    const avatarBytes = Uint8Array.from(atob(avatarBase64), character => character.charCodeAt(0))
    return await window.ftElectron.tabs.updateAvatar(
      avatarBytes.buffer,
      tabId,
      '/watch/jNQXAC9IVRw'
    )
  }, watchTab.id)
  expect(avatarCached).toBe(true)
  await expect(tab.locator('.loadingDot')).toHaveCount(0)
  await expect.poll(() => page.evaluate(tabId => (
    window.__backgroundWatchIconStates.some(state => state.id === tabId && !state.loading && state.avatar)
  ), watchTab.id)).toBe(true)

  const states = await page.evaluate(
    tabId => window.__backgroundWatchIconStates.filter(state => state.id === tabId),
    watchTab.id
  )
  expect(states.some(state => state.loading)).toBe(true)
  expect(states.some(state => !state.loading && state.avatar)).toBe(true)
  expect(states.some(state => state.loading && state.pageIcon)).toBe(false)
})

test('keeps background comment loading local to the loaded watch page', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', false)
  })
  await openMockedVideo(page)

  const watchTabId = await page.locator(sel.activeTab).getAttribute('data-tab-id')
  const watchTab = page.locator(`.tab[data-tab-id="${watchTabId}"]`)
  const watchContent = page.locator(`.tabContent[data-tab-id="${watchTabId}"]`)
  await expect(watchContent.locator('.getCommentsTitle')).toHaveCount(1)
  await expect(watchTab).not.toHaveClass(/loading/)

  let commentRequestStarted = false
  let releaseComments = () => {}
  const commentsReleased = new Promise(resolve => { releaseComments = resolve })
  await page.route(/\/youtubei\/v1\/next/, async (route, request) => {
    const body = JSON.parse(request.postData() ?? '{}')
    if (!body.continuation) return route.fallback()

    commentRequestStarted = true
    await commentsReleased
    return route.fallback()
  })

  try {
    await page.locator(sel.newTabButton).click()
    await expect(watchContent).toHaveAttribute('aria-hidden', 'true')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
    })
    await expect.poll(() => commentRequestStarted).toBe(true)
    await expect(watchContent.locator('.commentsArea .commentLoader')).toHaveCount(1)
    await expect(watchContent.locator('.commentsArea [data-tab-loading-indicator]')).toHaveCount(0)
    await expect(watchTab).not.toHaveClass(/loading/)
  } finally {
    releaseComments()
  }

  await expect(watchContent.locator('.commentsArea .commentLoader')).toHaveCount(0)

  const watchView = await watchViewHandle(page)
  await watchView.evaluate(view => { view.isLoading = true })
  await expect(watchTab).toHaveClass(/loading/)
  await watchView.evaluate(view => { view.isLoading = false })
  await expect(watchTab).not.toHaveClass(/loading/)
  await watchView.dispose()
})

for (const { defaultViewingMode, currentTheatreMode } of [
  { defaultViewingMode: 'theatre', currentTheatreMode: false },
  { defaultViewingMode: 'default', currentTheatreMode: true }
]) {
  test.describe(`recommended video morph with ${defaultViewingMode} as the default`, () => {
    test.use({
      seed: {
        settings: {
          ...WATCH_PAGE_SEED,
          defaultViewingMode
        }
      }
    })

    test(`uses the current ${currentTheatreMode ? 'theatre' : 'default'} layout`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)

      let releaseRecommendedPlayer
      await page.route(/\/youtubei\/v1\/player/, async (route, request) => {
        const videoId = JSON.parse(request.postData() ?? '{}').videoId
        if (videoId === 'recommended-video') {
          await new Promise(resolve => { releaseRecommendedPlayer = resolve })
        }
        return route.fallback()
      })

      await openMockedVideo(page)
      const watchView = await watchViewHandle(page)
      await watchView.evaluate(async (view, theatreMode) => {
        view.useTheatreMode = theatreMode
        view.recommendedVideos = [{
          videoId: 'recommended-video',
          title: 'Recommended video',
          author: 'Recommended channel',
          authorId: 'UC-recommended-channel',
          lengthSeconds: 60,
          published: Date.now(),
          type: 'video'
        }]
        await view.$nextTick()
      }, currentTheatreMode)
      const lazyRecommendation = page.locator('.watchVideoRecommendations > div').nth(1)
      await lazyRecommendation.evaluate(element => { element.style.minHeight = '1px' })
      await lazyRecommendation.scrollIntoViewIfNeeded()
      const recommendation = page.locator('.watchVideoRecommendations .title', {
        hasText: 'Recommended video'
      })
      await expect(recommendation).toBeVisible()

      await page.evaluate((activeTabSelector) => {
        const startViewTransition = document.startViewTransition.bind(document)
        document.startViewTransition = (update) => {
          window.__recommendedMorph = {
            sourceName: document.querySelector('.watchVideoRecommendations .thumbnailImage')
              ?.style.viewTransitionName
          }
          return startViewTransition(async () => {
            await update()
            const player = document.querySelector(`${activeTabSelector} .videoPlayer`)
            const layout = document.querySelector(`${activeTabSelector} .videoLayout`)
            window.__recommendedMorph.destinationName = getComputedStyle(player).viewTransitionName
            window.__recommendedMorph.usesTheatreLayout = layout.classList.contains('useTheatreMode')
          })
        }
      }, activeTab)

      await recommendation.click()
      await expect(page).toHaveURL(/#\/watch\/recommended-video/)
      await expect.poll(() => page.evaluate(() => window.__recommendedMorph)).toEqual({
        sourceName: 'video-morph',
        destinationName: 'video-morph',
        usesTheatreLayout: currentTheatreMode
      })
      expect(await watchView.evaluate(view => view.loadingTheatreMode)).toBe(currentTheatreMode)

      await expect.poll(() => typeof releaseRecommendedPlayer).toBe('function')
      releaseRecommendedPlayer()
    })
  })
}

const FULLSCREEN_PLAYLIST_ID = 'fullscreen-preview'
const FULLSCREEN_PLAYLIST = {
  _id: FULLSCREEN_PLAYLIST_ID,
  playlistName: 'Fullscreen preview',
  protected: false,
  description: '',
  videos: [{
    videoId: 'jNQXAC9IVRw',
    title: 'Me at the zoo',
    author: 'jawed',
    authorId: 'UC4QobU6STFB0P71PMvOGN5A',
    lengthSeconds: 19,
    playlistItemId: 'playlist-item-0',
    type: 'video'
  }, ...Array.from({ length: 29 }, (_, index) => ({
    videoId: `playlist${String(index + 1).padStart(3, '0')}`,
    title: `Playlist video ${index + 1}`,
    author: 'Playlist channel',
    authorId: 'UC-playlist-channel',
    lengthSeconds: 60,
    playlistItemId: `playlist-item-${index + 1}`,
    type: 'video'
  }))],
  createdAt: Date.now() - 86_400_000,
  lastUpdatedAt: Date.now() - 86_400_000
}

async function setWindowWidth(app, width) {
  await app.electronApp.evaluate(({ BrowserWindow }, targetWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    browserWindow.setBounds({ ...browserWindow.getBounds(), width: targetWidth })
  }, width)
}

async function mockTranslatedEndscreen(app, page) {
  await mockPlayableWatchPage(app, page)

  await page.route(/\/youtubei\/v1\/player/, (route, request) => {
    const videoId = JSON.parse(request.postData() ?? '{}').videoId ?? 'jNQXAC9IVRw'
    const response = demoPlayerResponse(videoId, {
      endscreen: {
        endscreenRenderer: {
          elements: [{
            endscreenElementRenderer: {
              style: 'VIDEO',
              title: { simpleText: 'Translated end-screen title' },
              endpoint: { watchEndpoint: { videoId: 'end-screen-video' } },
              image: {
                thumbnails: [{
                  url: 'https://i.ytimg.com/vi/end-screen-video/hqdefault.jpg',
                  width: 480,
                  height: 270
                }]
              },
              left: '0.1',
              top: '0.1',
              width: '0.3',
              aspectRatio: '1.777',
              startMs: '0',
              endMs: '30000',
              id: 'original-title-annotation'
            }
          }],
          startMs: '0'
        }
      }
    })

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    })
  })

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateAvoidTranslation', 'watch_only')
  })
}

test.describe('watch page', () => {
  test('keeps private and DRM errors ineligible for extraction retry after locale changes', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      view.setNonRetryablePlaybackError('private')
      await view.$nextTick()
    })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCurrentLocale', 'en-US')
    })
    await expect.poll(() => watchView.evaluate(view => view.currentLocale)).toBe('en-US')
    expect(await watchView.evaluate(view => view.errorMessage === view.t('Video.DRMProtected'))).toBe(false)
    await expect(page.locator('.errorActions')).toHaveCount(0)
  })

  test('retries an error with the other extraction method without changing the default', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://example.invalid/retry.m3u8', route => route.fulfill({
      contentType: 'application/x-mpegURL',
      body: '#EXTM3U\n'
    }))
    await app.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', () => ({
        isLive: false,
        liveStatus: 'not_live',
        hlsManifestUrl: 'https://example.invalid/retry.m3u8',
        formats: [],
        duration: 600,
        version: 'test'
      }))
    })
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    const builtInManifest = await watchView.evaluate((view) => view.manifestSrc)
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
      manifest: view.manifestSrc
    }))).toEqual({
      activeEngine: 'yt-dlp',
      errorMessage: null,
      manifest: 'https://example.invalid/retry.m3u8'
    })

    await watchView.evaluate(async (view) => {
      view.errorMessage = 'The yt-dlp extraction failed'
      await view.$nextTick()
      const retryButton = view.$el.querySelector('.errorActionButton')
      if (retryButton === null) {
        throw new Error('Built-in extraction retry button was not rendered')
      }
      retryButton.click()
    })
    await expect.poll(() => watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      errorMessage: view.errorMessage,
      manifest: view.manifestSrc
    }))).toEqual({
      activeEngine: 'built-in',
      errorMessage: null,
      manifest: builtInManifest
    })
    expect(await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getVideoPlaybackEngine
    })).toBe('built-in')
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

  test('ignores a superseded yt-dlp extraction after rapid engine switches', async ({ app, page }) => {
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
    await expect.poll(() => app.electronApp.evaluate(
      () => globalThis.__ytDlpPlaybackResolvers.length
    )).toBe(2)

    await app.electronApp.evaluate(() => {
      globalThis.__ytDlpPlaybackResolvers.shift()({
        isLive: true,
        liveStatus: 'is_live',
        hlsManifestUrl: 'https://example.invalid/first.m3u8',
        formats: [],
        duration: null,
        version: 'first'
      })
    })
    await page.evaluate(() => window.__firstEngineSwitch)
    expect(await watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      pending: view.ytDlpStreamsPending
    }))).toEqual({ activeEngine: 'built-in', pending: true })

    await app.electronApp.evaluate(() => {
      globalThis.__ytDlpPlaybackResolvers.shift()({
        isLive: true,
        liveStatus: 'is_live',
        hlsManifestUrl: 'https://example.invalid/second.m3u8',
        formats: [],
        duration: null,
        version: 'second'
      })
    })
    await page.evaluate(() => window.__secondEngineSwitch)
    expect(await watchView.evaluate((view) => ({
      activeEngine: view.activePlaybackEngine,
      builtInManifest: view.builtInPlaybackSource.manifestSrc,
      manifest: view.manifestSrc,
      pending: view.ytDlpStreamsPending,
      version: view.activePlaybackEngineVersion
    }))).toEqual({
      activeEngine: 'yt-dlp',
      builtInManifest,
      manifest: 'https://example.invalid/second.m3u8',
      pending: false,
      version: 'second'
    })
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
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator(`${activeTab} .videoLayout`)).toBeVisible()

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

  test('does not speculate about live chat while availability loads', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    let releaseMetadata
    await page.route(/\/youtubei\/v1\/next/, async (route) => {
      await new Promise(resolve => { releaseMetadata = resolve })
      await route.fallback()
    })

    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
    await expect(page.locator(`${activeTab} .sidebarArea > .liveChatSkeleton`)).toHaveCount(0)
    await expect(page.locator(`${activeTab} .sidebarArea > .recommendationsSkeleton`)).toBeVisible()

    await expect.poll(() => typeof releaseMetadata).toBe('function')
    releaseMetadata()
    await expect(page.locator(`${activeTab} .ftVideoPlayer`)).toBeVisible()
  })

  test('keeps live chat and replay visibility independent and restores a closed chat', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const watchView = await watchViewHandle(page)
    await watchView.evaluate(async (view) => {
      const listeners = new Map()
      const liveChat = new EventTarget()
      liveChat.is_replay = true
      liveChat.on = (event, listener) => {
        listeners.set(listener, event)
        liveChat.addEventListener(event, listener)
      }
      liveChat.once = (event, listener) => {
        listeners.set(listener, event)
        liveChat.addEventListener(event, listener, { once: true })
      }
      liveChat.off = (_event, listener) => {
        liveChat.removeEventListener(listeners.get(listener), listener)
        listeners.delete(listener)
      }
      liveChat.emit = (event, value) => {
        for (const [listener, listenerEvent] of listeners) {
          if (listenerEvent === event) {
            listener(value)
          }
        }
      }
      liveChat.start = () => {}
      liveChat.stop = () => {}

      view.$store.commit('setHideLiveChat', true)
      view.$store.commit('setHideLiveChatReplay', false)
      view.liveChat = liveChat
      view.liveChatIsReplay = true
      view.liveChatOpen = true
      view.isLive = false
      view.isUpcoming = false
      await view.$nextTick()
    })

    const replay = page.locator(`${activeTab} .watchVideoPlaylist`).filter({ hasText: 'Live Chat Replay' })
    await expect(replay).toBeVisible()
    const skeleton = replay.locator('.liveChatSkeleton')
    await expect(skeleton).toBeVisible()
    await expect(skeleton.locator('.liveChatSkeletonMessage')).toHaveCount(24)
    expect(await skeleton.evaluate((element) => {
      const firstMessage = element.querySelector('.liveChatSkeletonMessage')
      const avatar = firstMessage.querySelector('.liveChatSkeletonAvatar')
      const author = firstMessage.querySelector('.liveChatSkeletonAuthor')
      const text = firstMessage.querySelector('.liveChatSkeletonText')
      const skeletonRect = element.getBoundingClientRect()

      return {
        avatarInset: avatar.getBoundingClientRect().top - skeletonRect.top,
        clipsOverflow: element.scrollHeight > element.clientHeight &&
          getComputedStyle(element).overflowY === 'hidden',
        linesAligned: Math.abs(author.getBoundingClientRect().top - text.getBoundingClientRect().top) <= 1
      }
    })).toEqual({
      avatarInset: 5,
      clipsOverflow: true,
      linesAligned: true
    })
    const skeletonLines = skeleton.locator('.liveChatSkeletonContent').first().locator('div')
    await expect(skeletonLines.nth(0)).toHaveCSS('block-size', '10px')
    await expect(skeletonLines.nth(1)).toHaveCSS('block-size', '10px')

    await setPlayerFullscreen(page, true)
    await page.locator('video.player').evaluate(element => element.pause())
    const fullscreenLiveChatToggle = page.locator('.fullscreenLiveChatToggle')
    await fullscreenLiveChatToggle.click({ force: true })
    const fullscreenChat = page.locator('.fullscreenLiveChatOverlay.open')
    const fullscreenSkeleton = fullscreenChat.locator('.liveChatSkeleton')
    await expect(fullscreenSkeleton).toBeVisible()
    const fullscreenSkeletonGeometry = await fullscreenSkeleton.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const firstMessageBounds = element.firstElementChild.getBoundingClientRect()
      const lastMessageBounds = element.lastElementChild.getBoundingClientRect()

      return {
        firstMessageInlineInset: Math.round(firstMessageBounds.left - bounds.left),
        lastMessageBlockInset: Math.round(bounds.bottom - lastMessageBounds.bottom)
      }
    })
    expect(fullscreenSkeletonGeometry.firstMessageInlineInset).toBe(16)
    expect(fullscreenSkeletonGeometry.lastMessageBlockInset).toBeGreaterThanOrEqual(0)
    expect(fullscreenSkeletonGeometry.lastMessageBlockInset).toBeLessThan(30)

    await watchView.evaluate((view) => {
      const actions = Array.from({ length: 60 }, (_, index) => {
        let actionTypeChecks = 0
        return {
          is: () => ++actionTypeChecks === 2,
          item: {
            is: () => true,
            id: `mock-live-chat-message-${index}`,
            timestamp: Date.now(),
            message: { runs: [{ text: `Mock live chat message ${index}` }] },
            author: {
              badges: [],
              id: `mock-live-chat-author-${index}`,
              name: `Chat author ${index}`,
              thumbnails: [{ url: '' }],
              is_moderator: false
            }
          }
        }
      })
      view.liveChat.emit('start', { actions })
    })

    const liveChatComments = fullscreenChat.locator('.liveChatComments')
    await expect(liveChatComments).toBeVisible()
    await expect(liveChatComments).toHaveClass(/atLiveEdge/)
    await expect.poll(() => liveChatComments.evaluate(
      element => element.scrollHeight > element.clientHeight
    )).toBe(true)
    await liveChatComments.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => liveChatComments.evaluate(
      element => element.scrollTop
    )).toBeGreaterThan(0)

    const readbackAnchor = liveChatComments.locator('.comment').filter({
      has: page.getByText('Mock live chat message 30', { exact: true })
    })
    await liveChatComments.dispatchEvent('wheel')
    await liveChatComments.evaluate((element) => {
      const anchor = Array.from(element.querySelectorAll('.comment'))
        .find(comment => comment.querySelector('.chatMessage')?.textContent === 'Mock live chat message 30')
      element.scrollTop = anchor.offsetTop
    })
    const anchorTop = await readbackAnchor.evaluate((element) => (
      element.getBoundingClientRect().top - element.closest('.liveChatComments').getBoundingClientRect().top
    ))

    await watchView.evaluate((view) => {
      for (let index = 60; index < 520; index++) {
        let actionTypeChecks = 0
        view.liveChat.emit('chat-update', {
          is: () => ++actionTypeChecks === 2,
          item: {
            is: () => true,
            id: `mock-live-chat-message-${index}`,
            timestamp: Date.now(),
            message: { runs: [{ text: `Mock live chat message ${index}` }] },
            author: {
              badges: [],
              id: `mock-live-chat-author-${index}`,
              name: `Chat author ${index}`,
              thumbnails: [{ url: '' }],
              is_moderator: false
            }
          }
        })
      }
    })

    await expect(liveChatComments.locator('.comment')).toHaveCount(500)
    await expect(liveChatComments.locator('.chatMessage').first()).toHaveText('Mock live chat message 20')
    await expect.poll(() => readbackAnchor.evaluate((element) => Math.round(
      element.getBoundingClientRect().top - element.closest('.liveChatComments').getBoundingClientRect().top
    ))).toBe(Math.round(anchorTop))
    expect(await liveChatComments.evaluate((element) => {
      const content = element.querySelector('.liveChatCommentList')
      const maximumScrollTop = Math.max(0, content.offsetTop + content.offsetHeight - element.clientHeight)
      return {
        maximumScrollTop,
        overflowing: maximumScrollTop > 0,
        scrollTop: element.scrollTop,
        withinRange: element.scrollTop <= maximumScrollTop + 1
      }
    })).toMatchObject({ overflowing: true, withinRange: true })
    await expect(liveChatComments.locator(':scope > .os-scrollbar-vertical'))
      .not.toHaveClass(/os-scrollbar-unusable/)
    await fullscreenChat.getByRole('button', { name: 'Scroll to Bottom' }).click()

    await page.locator('.fullscreenCommentsToggle').click({ force: true })
    await expect(page.locator('.fullscreenCommentsOverlay.open')).toBeVisible()
    await expect.poll(() => liveChatComments.evaluate(element =>
      Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
    )).toBeLessThanOrEqual(1)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })
    await expect(page.locator('.fullscreenCommentsOverlay.open')).toHaveCount(0)

    await liveChatComments.locator('.comment').evaluateAll((comments) => {
      for (const comment of comments.slice(3)) {
        comment.style.display = 'none'
      }
    })
    await expect.poll(() => liveChatComments.evaluate(element => ({
      fits: element.scrollHeight <= element.clientHeight,
      scrollTop: element.scrollTop
    }))).toEqual({ fits: true, scrollTop: 0 })
    await expect(liveChatComments.locator(':scope > .os-scrollbar-vertical'))
      .toHaveClass(/os-scrollbar-unusable/)

    await fullscreenLiveChatToggle.click({ force: true })
    await expect(fullscreenChat).toHaveCount(0)
    await setPlayerFullscreen(page, false)
    await watchView.evaluate((view) => {
      view.liveChat.dispatchEvent(new ErrorEvent('error', { message: 'Unavailable' }))
    })
    await expect(replay.locator('.messageContainer.hasError')).toBeVisible()
    await expect(replay.locator('.titleContainer')).toHaveCSS('margin-block-start', '0px')
    await replay.getByRole('button', { name: 'Close Live Chat Replay' }).click()
    await expect(replay).toHaveCount(0)

    const replayToggle = page.getByTitle('Show Live Chat Replay')
    await expect(replayToggle).toBeVisible()
    await replayToggle.click()
    await expect(replay).toBeVisible()
    await expect(replay.getByRole('button', { name: 'Close Live Chat Replay' })).toBeVisible()

    await watchView.evaluate(async (view) => {
      view.$store.commit('setHideLiveChat', false)
      view.$store.commit('setHideLiveChatReplay', true)
      await view.$nextTick()
    })
    await expect(replay).toHaveCount(0)
    await expect(page.getByTitle('Show Live Chat Replay')).toHaveCount(0)

    await watchView.evaluate(async (view) => {
      view.liveChat.is_replay = false
      view.liveChatIsReplay = false
      view.isLive = true
      await view.$nextTick()
    })
    const activeChat = page.locator(`${activeTab} .watchVideoPlaylist`).filter({ hasText: 'Live Chat' })
    await expect(activeChat).toBeVisible()
    await activeChat.getByRole('button', { name: 'Close Live Chat' }).click()
    await expect(activeChat).toHaveCount(0)

    const activeChatToggle = page.getByTitle('Show Live Chat')
    await expect(activeChatToggle).toBeVisible()
    await activeChatToggle.click()
    await expect(activeChat).toBeVisible()

    await activeChat.locator('.liveChatSkeleton').evaluate(element => {
      const owner = document.createElement('a')
      owner.className = 'channelName owner'
      owner.textContent = 'Channel owner'
      for (const attribute of element.getAttributeNames()) {
        if (attribute.startsWith('data-v-')) {
          owner.setAttribute(attribute, '')
        }
      }
      element.replaceWith(owner)
    })

    const owner = activeChat.locator('.channelName.owner', { hasText: 'Channel owner' })
    await expect(owner).toHaveCSS('border-radius', '2px')
    await page.locator('body').evaluate(element => {
      element.style.setProperty('--ui-roundness', '2')
    })
    await expect(owner).toHaveCSS('border-radius', '4px')
    await attachScreenshot('rounded live chat owner label')

    await watchView.evaluate(async (view) => {
      view.$store.commit('setHideLiveChat', true)
      await view.$nextTick()
    })
    await expect(activeChat).toHaveCount(0)
  })

  test('transitions a premiere when relative timestamp updates are disabled', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await page.clock.install({ time: Date.now() })

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      const watchView = component.proxy
      watchView.$store.commit('setUpdateRelativeTimestamps', false)
      watchView.isLoading = false
      watchView.errorMessage = ''
      watchView.isUpcoming = true
      watchView.playabilityStatus = 'UNPLAYABLE'
      watchView.upcomingTimestamp = 'August 11 at 5:00 PM'
      watchView.upcomingTimeLeft = 'in less than a minute'
      watchView.premiereDate = new Date(Date.now() + 60_000)
      watchView.scheduleLiveReminderStartInvalidation()
      await watchView.$nextTick()
    })

    await expect(page.locator(`${activeTab} .premiereTextTimeLeft`)).toHaveCount(1)

    await page.clock.fastForward(60_001)

    await expect(page.locator(`${activeTab} .premiereTextTimeLeft`)).toHaveCount(0)
    await expect(page.locator(`${activeTab} .premiereText`)).toHaveText(
      'Starting soon, please refresh the page to check again'
    )
  })

  test('keeps original video titles in end-screen annotations', async ({ app, page }) => {
    await mockTranslatedEndscreen(app, page)
    await page.route(/\/oembed\?/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: 'Original end-screen title' })
    }))

    await openMockedVideo(page)
    await waitForPlayback(page)

    await expect(page.locator(`${activeTab} .annotationTitleText`))
      .toHaveText('Original end-screen title')
  })

  test('does not replace an end-screen title after original text is disabled', async ({ app, page }) => {
    await mockTranslatedEndscreen(app, page)

    let releaseOembed
    let markOembedRequested
    const oembedRequested = new Promise((resolve) => { markOembedRequested = resolve })
    await page.route(/\/oembed\?/, async (route) => {
      markOembedRequested()
      await new Promise((resolve) => { releaseOembed = resolve })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ title: 'Original end-screen title' })
      })
    })

    await openMockedVideo(page)
    await waitForPlayback(page)
    await oembedRequested

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateAvoidTranslation', 'disabled')
    })
    const oembedResponse = page.waitForResponse(/\/oembed\?/)
    releaseOembed()
    await oembedResponse
    await page.waitForTimeout(100)

    await expect(page.locator(`${activeTab} .annotationTitleText`))
      .toHaveText('Translated end-screen title')
  })

  test('shows tags below the description and copies the description', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const videoDescription = Array(30).fill('Description to copy').join('\n')
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component, description) => {
      const watchView = component.proxy
      watchView.isLoading = true
      await watchView.$nextTick()
      watchView.videoDescription = description
      watchView.videoDescriptionHtml = ''
      watchView.videoTags = ['first tag', 'second tag']
      watchView.isLoading = false
      await watchView.$nextTick()
    }, videoDescription)

    const description = page.locator(`${activeTab} .videoDescription`)
    const descriptionText = description.locator('.description')
    const tags = description.locator('.videoTags')
    const expandControl = description.locator(':scope > .descriptionStatus')
    const copyButton = description.locator('.descriptionCopyButton')
    const controlsOverlap = async () => expandControl.evaluate((element, copyButtonElement) => {
      const expandRect = element.getBoundingClientRect()
      const copyRect = copyButtonElement.getBoundingClientRect()
      return (
        expandRect.top < copyRect.bottom &&
        expandRect.bottom > copyRect.top &&
        expandRect.left < copyRect.right &&
        expandRect.right > copyRect.left
      )
    }, await copyButton.elementHandle())

    await description.evaluate(element => { element.style.height = '70px' })
    await expect(expandControl).toHaveClass(/avoidCopyButton/)
    expect(await controlsOverlap()).toBe(false)

    await description.evaluate(element => { element.style.height = '160px' })
    await expect(expandControl).not.toHaveClass(/avoidCopyButton/)
    await expect(expandControl).toHaveCSS('inset-inline-end', '16px')

    await description.evaluate(element => {
      element.dir = 'rtl'
      element.style.height = '70px'
    })
    await expect(expandControl).toHaveClass(/avoidCopyButton/)
    expect(await controlsOverlap()).toBe(false)

    await description.evaluate(element => { element.style.height = '' })

    await expandControl.click()
    await expect(tags.locator('.videoTagLink')).toHaveText(['first tag', 'second tag'])
    await expect(tags.locator('.videoTagLink').first()).toHaveAttribute('href', /\/search\/first%20tag/)
    await expect(description.locator('.descriptionScroll')).toHaveCSS('overflow-anchor', 'none')
    expect(await descriptionText.evaluate((element, tagsElement) => (
      Boolean(element.compareDocumentPosition(tagsElement) & Node.DOCUMENT_POSITION_FOLLOWING)
    ), await tags.elementHandle())).toBe(true)
    expect(await tags.evaluate(element => element.closest('.descriptionScroll') !== null)).toBe(true)
    const descriptionScroll = description.locator('.descriptionScroll')
    expect(await descriptionScroll.evaluate(element => getComputedStyle(element).maskImage))
      .toContain('linear-gradient')
    await expect(descriptionScroll).not.toHaveClass(/descriptionFadeTop/)
    const collapseControl = description.locator('.descriptionScroll > .descriptionStatus')
    await expect(collapseControl).toBeVisible()
    await expect(collapseControl).toHaveCSS('position', 'sticky')
    const collapseControlStyles = await collapseControl.evaluate(element => {
      const style = getComputedStyle(element)
      const fadeStyle = getComputedStyle(element, '::before')
      return {
        fadeBackground: fadeStyle.backgroundImage,
        fadeHeight: Number.parseFloat(fadeStyle.height),
        fontSize: Number.parseFloat(style.fontSize),
        marginBlockStart: Number.parseFloat(style.marginBlockStart)
      }
    })
    expect(collapseControlStyles.fadeBackground).toContain('linear-gradient')
    expect(collapseControlStyles.fadeHeight).toBeGreaterThan(0)
    expect(collapseControlStyles.marginBlockStart).toBeGreaterThan(collapseControlStyles.fontSize)
    const maxScrollTop = await descriptionScroll.evaluate(element =>
      element.scrollHeight - element.clientHeight
    )
    expect(maxScrollTop).toBeGreaterThan(0)
    await descriptionScroll.evaluate((element, maxScrollTop) => {
      element.scrollTop = maxScrollTop / 2
    }, maxScrollTop)
    await expect.poll(() => descriptionScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(descriptionScroll).toHaveClass(/descriptionFadeTop/)
    await expect.poll(() => descriptionScroll.evaluate(element =>
      element.scrollTop < element.scrollHeight - element.clientHeight
    )).toBe(true)
    await expect.poll(() => collapseControl.evaluate(element => {
      const controlBottom = element.getBoundingClientRect().bottom
      const scrollBottom = element.parentElement.getBoundingClientRect().bottom
      return Math.abs(controlBottom - scrollBottom) <= 1
    })).toBe(true)

    await description.locator('.descriptionCopyButton button').click()
    await expect(page.locator('.toast', { hasText: 'Description copied to clipboard' })).toBeVisible()
    await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(videoDescription)
    await watchComponent.dispose()
  })

  test('handles videos without a description', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async component => {
      const watchView = component.proxy
      watchView.isLoading = true
      await watchView.$nextTick()
      watchView.videoDescription = ''
      watchView.videoDescriptionHtml = ''
      watchView.videoTags = []
      watchView.videoGames = []
      watchView.isLoading = false
      await watchView.$nextTick()
    })

    await expect(page.locator(`${activeTab} .videoDescription`)).toHaveCount(0)
    expect(pageErrors).toEqual([])
    await watchComponent.dispose()
  })

  test('the sidebar panels use overlay scrollbars', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    // Whether these overflow depends on the video, so assert that the directive
    // took hold rather than measuring widths: the panel stays the scrolling
    // element and gets its own overlay scrollbars.
    for (const selector of ['.descriptionScroll', '.commentsContentWrapper']) {
      await expect(page.locator(selector)).toBeVisible({ timeout: 30_000 })
      await expect(page.locator(`${selector}[data-overlayscrollbars-viewport]`)).toHaveCount(1)
      await expect(page.locator(`${selector} > .os-scrollbar-vertical`)).toHaveCount(1)
    }
  })

  test('resets the Shorts auxiliary viewport when switching panels', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
    await openMockedVideo(page)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      const watchView = component.proxy
      watchView.isLoading = true
      await watchView.$nextTick()
      watchView.isShort = true
      watchView.videoDescription = Array(200).fill('Long Shorts metadata').join('\n')
      watchView.videoDescriptionHtml = ''
      watchView.shortsMetadataOpen = true
      watchView.isLoading = false
      await watchView.$nextTick()
    })

    const target = page.locator('.shortsAuxPanelTarget')
    await expect(page.locator('.shortsAuxPanel')).toHaveClass(/shortsAuxPanelOpen/)
    await expect.poll(() => target.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await target.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await watchComponent.evaluate(async (component) => {
      component.proxy.toggleTranscript()
      await component.proxy.$nextTick()
    })
    await expect(page.locator('.shortsAuxPanelTarget .watchVideoTranscript')).toBeVisible()
    await page.waitForTimeout(250)
    expect(await target.evaluate(element => element.scrollTop)).toBe(0)

    const transcript = page.locator('.shortsAuxPanelTarget .watchVideoTranscript')
    await transcript.evaluate(element => { element.style.blockSize = '200%' })
    await target.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await watchComponent.evaluate(async (component) => {
      component.proxy.closeTranscript()
      await component.proxy.$nextTick()
    })
    await expect(transcript).toHaveCount(0)
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBe(0)

    await watchComponent.evaluate(async (component) => {
      component.proxy.handleSponsorBlockInfoChange({
        open: true,
        loading: false,
        pendingUuid: null,
        segments: [],
        submissionEnabled: false
      })
      await component.proxy.$nextTick()
    })
    const sponsorBlock = page.locator('.shortsAuxPanelTarget .watchVideoSponsorBlock')
    await expect(sponsorBlock).toBeVisible()
    await sponsorBlock.evaluate(element => { element.style.blockSize = '200%' })
    await target.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await watchComponent.evaluate(async (component) => {
      component.proxy.handleSponsorBlockInfoChange({
        open: false,
        loading: false,
        pendingUuid: null,
        segments: [],
        submissionEnabled: false
      })
      await component.proxy.$nextTick()
    })
    await expect(sponsorBlock).toHaveCount(0)
    await expect.poll(() => target.evaluate(element => element.scrollTop)).toBe(0)

    await watchComponent.dispose()
  })

  test('shares the Shorts information dock with fullscreen and keeps its settings menu visible', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:center' })
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw\?short=true/)
    await waitForPlayback(page)
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      await Promise.all([
        component.proxy.$store.dispatch('updateRememberPlaybackSpeedPerChannel', true),
        component.proxy.$store.dispatch('updateRememberVideoQualityPerChannel', true),
      ])
      await component.proxy.$nextTick()
    })

    const player = page.locator('.ftVideoPlayer.shortsPlayer')
    const moreOptions = player.getByRole('button', { name: 'More Options' })
    const overflowMenu = player.locator('.shaka-overflow-menu')
    const auxPanel = page.locator('.shortsAuxPanel')

    await moreOptions.click()
    await expect(overflowMenu.locator(':scope > button').first())
      .toHaveAccessibleName('Video information')
    await overflowMenu.getByRole('button', { name: 'Video information' }).click()
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await auxPanel.getByRole('button', { name: /Save channel setting/i }).click()
    const settingsMenu = page.locator('.app > .iconDropdown.portal')
    await expect(settingsMenu).toBeVisible()
    expect(await settingsMenu.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      )
      return element.contains(hit)
    })).toBe(true)
    await page.keyboard.press('Escape')

    await setPlayerFullscreen(page, true)
    const fullscreenMetadata = player.locator('.fullscreenMetadataOverlay.open')
    await expect(fullscreenMetadata).toBeVisible()
    await expect(player).not.toHaveClass(/presentationModeChanging/)

    expect(await player.evaluate(element => {
      const movingProperties = [
        ['.player', 'inline-size'],
        ['.shaka-controls-container', 'inline-size'],
        ['.shortsTopControls', 'inset-inline-start'],
        ['.shortsTopControls', 'max-inline-size'],
        ['.fullscreenActions', 'inset-inline-end']
      ]
      return movingProperties.map(([selector, property]) => {
        const style = getComputedStyle(element.querySelector(selector))
        const properties = style.transitionProperty.split(', ')
        const durations = style.transitionDuration.split(', ')
        const index = properties.indexOf(property)
        return index === -1 ? null : durations[index % durations.length]
      })
    })).toEqual(Array(5).fill('0.25s'))

    expect(await player.evaluate(element => {
      return getComputedStyle(
        element.querySelector('.shaka-seek-bar-container')
      ).transitionProperty
    })).toBe('none')

    const closingMotion = player.evaluate(element => new Promise(resolve => {
      const controls = element.querySelector('.shaka-controls-container')
      const seek = element.querySelector('.shaka-seek-bar-container')
      const initial = {
        seekLeft: seek.getBoundingClientRect().left
      }
      controls.addEventListener('transitionrun', event => {
        resolve({ initial, transitionProperty: event.propertyName })
      }, { once: true })
    }))
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenMetadata(false)
    })
    const { initial, transitionProperty } = await closingMotion
    await expect(fullscreenMetadata).toHaveCount(0)
    const fullscreenWidth = (await player.boundingBox()).width
    expect(['inline-size', 'width']).toContain(transitionProperty)
    await expect.poll(async () => {
      return player.locator('.shaka-controls-container').evaluate(element => {
        return element.getBoundingClientRect().width
      })
    }).toBeCloseTo(fullscreenWidth, 0)
    const closedSeekLeft = await player.locator('.shaka-seek-bar-container').evaluate(element => {
      return element.getBoundingClientRect().left
    })
    expect(closedSeekLeft).toBeGreaterThan(initial.seekLeft)

    const reopeningMotion = player.evaluate(element => new Promise(resolve => {
      const controls = element.querySelector('.shaka-controls-container')
      controls.addEventListener('transitionend', event => {
        resolve(event.propertyName)
      }, { once: true })
    }))
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenMetadata(true)
    })
    await expect(fullscreenMetadata).toBeVisible()
    expect(['inline-size', 'width']).toContain(await reopeningMotion)
    const reopenedControlsWidth = await player.locator('.shaka-controls-container').evaluate(element => {
      return element.getBoundingClientRect().width
    })
    expect(reopenedControlsWidth).toBeLessThan(fullscreenWidth)
    const reopenedSeekLeft = await player.locator('.shaka-seek-bar-container').evaluate(element => {
      return element.getBoundingClientRect().left
    })
    expect(reopenedSeekLeft).toBeLessThan(closedSeekLeft)

    await moreOptions.click({ force: true })
    await expect(overflowMenu).toBeVisible()
    await expect.poll(async () => {
      const [buttonBounds, menuBounds] = await Promise.all([
        moreOptions.boundingBox(),
        overflowMenu.boundingBox()
      ])
      return Math.max(
        Math.abs(buttonBounds.x + buttonBounds.width - menuBounds.x - menuBounds.width),
        Math.abs(buttonBounds.y + buttonBounds.height + 8 - menuBounds.y)
      )
    }).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    await expect(overflowMenu).toBeHidden()

    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenTranscript(true)
    })
    const fullscreenTranscript = player.locator('.fullscreenTranscriptOverlay.open')
    await expect(fullscreenTranscript).toBeVisible()
    await fullscreenMetadata.locator('.fullscreenMetadataHeader').dblclick({
      position: { x: 30, y: 26 }
    })
    await expect.poll(async () => (await fullscreenMetadata.boundingBox()).height)
      .toBeLessThan(100)
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenTranscript(false)
    })
    await expect(fullscreenTranscript).toHaveCount(0)
    await fullscreenMetadata.getByRole('button', { name: 'Close video information' }).click()
    await player.locator('.shortsFullscreenTitleButton').click()
    await watchComponent.evaluate(component => {
      component.proxy.$refs.player.setFullscreenTranscript(true)
    })
    await expect.poll(async () => (await fullscreenMetadata.boundingBox()).height)
      .toBeGreaterThan(150)

    await setPlayerFullscreen(page, false)
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await auxPanel.getByRole('button', { name: 'Close video information' }).click()
    await expect(auxPanel).not.toHaveClass(/shortsAuxPanelOpen/)

    await setPlayerFullscreen(page, true)
    await moreOptions.click({ force: true })
    await overflowMenu.getByRole('button', { name: 'Video information' }).click()
    await expect(player.locator('.fullscreenMetadataOverlay.open')).toBeVisible()

    await moreOptions.click({ force: true })
    await expect(overflowMenu).toBeVisible()
    await setPlayerFullscreen(page, false)
    await expect(overflowMenu).toBeHidden()
    await expect(auxPanel).toHaveClass(/shortsAuxPanelOpen/)

    await moreOptions.click()
    await expect(overflowMenu).toBeVisible()
    await expect.poll(async () => {
      const [buttonBounds, menuBounds] = await Promise.all([
        moreOptions.boundingBox(),
        overflowMenu.boundingBox()
      ])
      return Math.max(
        Math.abs(buttonBounds.x + buttonBounds.width - menuBounds.x - menuBounds.width),
        Math.abs(buttonBounds.y + buttonBounds.height + 8 - menuBounds.y)
      )
    }).toBeLessThanOrEqual(1)

    await watchComponent.dispose()
  })

  test('toggles information from the Shorts title and matches the comments header', async ({ app, page }) => {
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateBaseTheme', 'light')
    })
    await expect(page.locator('body')).toHaveClass(/light/)
    await mockPlayableWatchPage(app, page)
    await page.locator(sel.searchInput).fill('https://www.youtube.com/shorts/jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw\?short=true/)
    await waitForPlayback(page)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    const titleButton = page.locator('.shortsExternalTitleButton')
    await expect(titleButton).toHaveAttribute('aria-expanded', 'false')
    await titleButton.click()
    await expect(page.locator('.shortsAuxPanel')).toHaveClass(/shortsAuxPanelOpen/)
    await expect(titleButton).toHaveAttribute('aria-expanded', 'true')

    const headerStyles = async (headerSelector, closeSelector) => page.evaluate(
      ({ headerSelector, closeSelector }) => {
        const header = document.querySelector(headerSelector)
        const heading = header?.querySelector('h2, h3')
        const close = document.querySelector(closeSelector)
        const headerStyle = getComputedStyle(header)
        const headingStyle = getComputedStyle(heading)
        const closeStyle = getComputedStyle(close)
        return {
          header: {
            height: headerStyle.height,
            padding: headerStyle.padding,
            backgroundColor: headerStyle.backgroundColor,
            borderBottomColor: headerStyle.borderBottomColor
          },
          heading: {
            margin: headingStyle.margin,
            fontSize: headingStyle.fontSize,
            color: headingStyle.color
          },
          close: {
            width: closeStyle.width,
            height: closeStyle.height,
            color: closeStyle.color,
            backgroundColor: closeStyle.backgroundColor,
            borderRadius: closeStyle.borderRadius,
            fontSize: closeStyle.fontSize
          }
        }
      },
      { headerSelector, closeSelector }
    )

    const informationStyles = await headerStyles(
      '.shortsAuxPanelHeader',
      '.shortsAuxPanelClose'
    )

    await titleButton.click()
    await expect(page.locator('.shortsAuxPanel')).not.toHaveClass(/shortsAuxPanelOpen/)
    await expect(titleButton).toHaveAttribute('aria-expanded', 'false')

    await watchComponent.evaluate(async (component) => {
      component.proxy.toggleShortsComments()
      await component.proxy.$nextTick()
    })
    await expect(page.locator('.shortsCommentsPanel .fullscreenCommentHeader')).toBeVisible()
    const commentText = page.locator('.shortsCommentsPanel .commentText').first()
    await expect(commentText).toBeVisible()
    const commentContrast = await commentText.evaluate(element => {
      const parseRgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number)
      const luminance = value => {
        const channels = parseRgb(value).map(channel => {
          const normalized = channel / 255
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
      }
      const foreground = luminance(getComputedStyle(element).color)
      const background = luminance(getComputedStyle(element.closest('.shortsCommentsPanel')).backgroundColor)
      return (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05)
    })
    expect(commentContrast).toBeGreaterThanOrEqual(4.5)
    const commentsStyles = await headerStyles(
      '.shortsCommentsPanel .fullscreenCommentHeader',
      '.shortsCommentsPanel .fullscreenCommentAction:last-of-type'
    )

    expect(informationStyles.header.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(informationStyles.heading.color).toBe(informationStyles.close.color)
    expect(informationStyles).toEqual(commentsStyles)
    await watchComponent.dispose()
  })

  test('sidebar chapters and SponsorBlock honor roundness while closing beside the description', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    await page.evaluate(async () => {
      const layout = document.querySelector('.videoLayout')
      const app = document.querySelector('#app')?.__vue_app__
      const findWatchView = (vnode) => {
        if (vnode?.component?.refs?.videoLayout === layout) {
          return vnode.component.proxy
        }
        if (vnode?.component?.subTree) {
          const match = findWatchView(vnode.component.subTree)
          if (match) {
            return match
          }
        }
        if (Array.isArray(vnode?.children)) {
          for (const child of vnode.children) {
            const match = findWatchView(child)
            if (match) {
              return match
            }
          }
        }
        return null
      }
      const watchView = findWatchView(app?._container?._vnode)
      if (!watchView) {
        throw new Error('Unable to access the watch view')
      }

      document.body.style.setProperty('--ui-roundness', '2')
      window.__sidebarRoundnessWatchView = watchView
      await watchView.$store.dispatch('updateHideRecommendedVideos', true)
      watchView.useTheatreMode = true
      watchView.videoChapters = Array.from({ length: 6 }, (_, index) => ({
        title: `Test chapter ${index + 1}`,
        timestamp: `${index}:00`,
        startSeconds: index * 60
      }))
      watchView.videoCurrentChapterIndex = 5
      watchView.showSidebarChapters = true
      await watchView.$nextTick()
    })

    const layout = page.locator('.videoLayout')
    const panel = page.locator('.watchVideoChaptersPanel')
    const standardCardRadius = await page.locator('.watchVideoInfo.ft-card').evaluate(element => {
      return getComputedStyle(element).borderRadius
    })
    await expect(layout).toHaveClass(/useTheatreMode/)
    await expect(panel).toBeVisible()
    expect(standardCardRadius).toBe('16px')
    await expect(panel).toHaveCSS('border-radius', standardCardRadius)
    await expect(panel).not.toHaveClass(/chapters-panel-enter-active/)
    await expect.poll(() => panel.evaluate((element) => {
      const container = element.querySelector('.chaptersWrapper')
      const scrollbar = container?.querySelector(':scope > .os-scrollbar-vertical')
      return container && {
        hasVisibleScrollbar: scrollbar?.classList.contains('os-scrollbar-visible'),
        scrollTop: container.scrollTop,
      }
    })).toEqual({
      hasVisibleScrollbar: false,
      scrollTop: 0,
    })
    await expect.poll(() => panel.evaluate((element) => {
      const container = element.querySelector('.chaptersWrapper')
      const currentChapter = container?.querySelector('.chapter.current')
      const containerBounds = container?.getBoundingClientRect()
      const chapterBounds = currentChapter?.getBoundingClientRect()
      return Boolean(
        containerBounds &&
        chapterBounds &&
        chapterBounds.top >= containerBounds.top &&
        chapterBounds.bottom <= containerBounds.bottom
      )
    })).toBe(true)

    await panel.getByRole('button', { name: 'Close Chapters' }).click()
    await expect(panel).toHaveClass(/chapters-panel-leave-active/)
    const leavingScrollbar = await panel.evaluate((element) => {
      const viewport = element.querySelector('.chaptersWrapper')
      return viewport && {
        initializing: viewport.hasAttribute('data-overlayscrollbars-initialize'),
        nativeScrollbarWidth: getComputedStyle(viewport).scrollbarWidth
      }
    })
    expect(leavingScrollbar).toEqual({
      initializing: true,
      nativeScrollbarWidth: 'none'
    })

    const leavingLayout = await page.evaluate(() => {
      const layoutElement = document.querySelector('.videoLayout')
      const infoElement = document.querySelector('.infoArea')
      const panelElement = document.querySelector('.watchVideoChaptersPanel')
      const infoBounds = infoElement.getBoundingClientRect()
      const panelBounds = panelElement.getBoundingClientRect()

      return {
        noSidebar: layoutElement.classList.contains('noSidebar'),
        infoRight: infoBounds.right,
        panelLeft: panelBounds.left
      }
    })
    expect(leavingLayout.noSidebar).toBe(false)
    expect(leavingLayout.panelLeft).toBeGreaterThanOrEqual(leavingLayout.infoRight - 1)

    await expect(panel).toHaveCount(0)
    await expect(layout).toHaveClass(/noSidebar/)

    await page.evaluate(async () => {
      window.__sidebarRoundnessWatchView.showSidebarSponsorBlock = true
      await window.__sidebarRoundnessWatchView.$nextTick()
    })
    await expect(page.locator('.watchVideoSponsorBlock')).toHaveCSS(
      'border-radius',
      standardCardRadius
    )
  })

  test('fullscreen metadata uses one full-dock scrollbar', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setPlayerFullscreen(page, true)
    await page.locator('.playerFullscreenTitleOverlay').click({ force: true })

    const metadata = page.locator('.fullscreenMetadataOverlay.open')
    const target = metadata.locator('.fullscreenMetadataTarget')
    await expect(metadata).toBeVisible()
    await expect(target).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(metadata.locator('.os-scrollbar-vertical')).toHaveCount(1)
    await expect(metadata.locator('.descriptionScroll'))
      .not.toHaveAttribute('data-overlayscrollbars-viewport')

    await metadata.locator('.description').evaluate((element) => {
      element.textContent = Array.from(
        { length: 100 },
        (_, index) => `Long description line ${index + 1}`
      ).join('\n')
    })
    await expect.poll(() => target.evaluate(
      element => element.scrollHeight > element.clientHeight
    )).toBe(true)

    const scrollbar = target.locator(':scope > .os-scrollbar-vertical')
    const scrollbarBounds = await scrollbar.boundingBox()
    const targetBounds = await target.boundingBox()
    expect(Math.abs(scrollbarBounds.y - targetBounds.y)).toBeLessThanOrEqual(1)
    expect(
      Math.abs(
        targetBounds.y + targetBounds.height -
        scrollbarBounds.y - scrollbarBounds.height
      )
    ).toBeLessThanOrEqual(1)

    await target.evaluate(element => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 3
    })
    await expect.poll(() => target.evaluate(
      element => element.scrollTop
    )).toBeGreaterThan(0)
    const handle = scrollbar.locator('.os-scrollbar-handle')
    await handle.hover()
  })

  test('fullscreen comments scrollbar reaches the dock bottom', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })

    const dock = page.locator('.fullscreenCommentsOverlay.open')
    const content = dock.locator('.commentsContentWrapper')
    await expect(content).toBeVisible()

    const bottomGap = await Promise.all([dock.boundingBox(), content.boundingBox()])
      .then(([dockBox, contentBox]) => (
        dockBox.y + dockBox.height - contentBox.y - contentBox.height
      ))
    expect(bottomGap).toBeLessThanOrEqual(2)
  })

  test('fullscreen SponsorBlock uses one content scrollbar', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
    })
    await openMockedVideo(page)
    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenSponsorBlockToggle').click({ force: true })

    const sponsorBlock = page.locator('.fullscreenSponsorBlockOverlay.open')
    await expect(sponsorBlock).toBeVisible()
    await expect(sponsorBlock.locator('.sponsorBlockContent'))
      .toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(sponsorBlock.locator('.sponsorBlockSegments'))
      .not.toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(sponsorBlock.locator('.os-scrollbar-vertical')).toHaveCount(1)
  })

  test('shows SponsorBlock contribution stats for the existing user ID', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    let expectedPublicUserId = 'test-contributor'
    for (let round = 0; round < 5000; round++) {
      expectedPublicUserId = crypto.createHash('sha256').update(expectedPublicUserId).digest('hex')
    }

    let userInfoRequests = 0
    let requestedUserInfoUrl = null
    let segmentRequests = 0
    await page.route('**/api/skipSegments/**', async (route) => {
      segmentRequests++
      const segments = segmentRequests === 1
        ? Array.from({ length: 18 }, (_, index) => ({
            UUID: `contribution-stats-segment-${index}`,
            actionType: 'skip',
            category: 'sponsor',
            description: '',
            locked: 0,
            segment: [index, index + 0.5],
            videoDuration: 19,
            votes: 1
          }))
        : []
      await route.fulfill({
        body: JSON.stringify([{ videoID: 'jNQXAC9IVRw', segments }]),
        contentType: 'application/json'
      })
    })
    await page.route('**/api/userInfo?*', async (route) => {
      userInfoRequests++
      requestedUserInfoUrl = new URL(route.request().url())
      const publicUserIdMatches = requestedUserInfoUrl.searchParams.get('publicUserID') === expectedPublicUserId
      await route.fulfill({
        body: JSON.stringify(publicUserIdMatches
          ? {
              segmentCount: 42,
              viewCount: 1234,
              minutesSaved: 22759
            }
          : {
              segmentCount: 0,
              viewCount: 0,
              minutesSaved: 0
            }),
        contentType: 'application/json'
      })
    })

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      store.commit('setSponsorBlockGeneratedUserId', 'test-contributor')
      await store.dispatch('updateUiScale', 125)
    })
    await openMockedVideo(page)
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()

    const panel = page.locator('.watchVideoSponsorBlock')
    const stats = panel.locator('.sponsorBlockContributionStats')
    await expect(stats).toContainText('Your contributions')
    await expect(stats.locator('dt')).toHaveText(['Submissions', 'Segments', 'Time saved'])
    await expect(stats.locator('dd')).toHaveText(['42', '1,234', '379 hr 19 min'])
    const metricLayout = await stats.locator('.sponsorBlockContributionMetric').evaluateAll(metrics => {
      return metrics.map((metric) => {
        const labelBounds = metric.querySelector('dt').getBoundingClientRect()
        const valueBounds = metric.querySelector('dd').getBoundingClientRect()
        const metricBounds = metric.getBoundingClientRect()
        return {
          labelBottom: labelBounds.bottom,
          metricCenter: metricBounds.left + metricBounds.width / 2,
          valueCenter: valueBounds.top + valueBounds.height / 2,
          valueTop: valueBounds.top
        }
      })
    })
    expect(metricLayout.every(({ labelBottom, valueTop }) => labelBottom <= valueTop)).toBe(true)
    expect(Math.abs(
      (metricLayout[1].metricCenter - metricLayout[0].metricCenter) -
      (metricLayout[2].metricCenter - metricLayout[1].metricCenter)
    )).toBeLessThanOrEqual(1)
    expect(Math.max(...metricLayout.map(({ valueCenter }) => valueCenter)) -
      Math.min(...metricLayout.map(({ valueCenter }) => valueCenter))).toBeLessThanOrEqual(1)
    await expect(panel.locator('.sponsorBlockSegment')).toHaveCount(18)
    expect(userInfoRequests).toBe(1)
    expect(requestedUserInfoUrl.searchParams.get('publicUserID')).toBe(expectedPublicUserId)
    expect(JSON.parse(requestedUserInfoUrl.searchParams.get('values'))).toEqual([
      'segmentCount',
      'viewCount',
      'minutesSaved'
    ])

    const content = panel.locator('.sponsorBlockContent')
    await panel.evaluate((element) => { element.style.inlineSize = '240px' })
    await expect(panel).toHaveCSS('width', '240px')
    await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const narrowScrollTop = await content.evaluate(element => element.scrollTop)
    await panel.evaluate((element) => { element.style.inlineSize = '' })
    await expect.poll(() => panel.evaluate(element => element.getBoundingClientRect().width))
      .toBeGreaterThan(240)
    await expect.poll(() => content.evaluate((element, previousScrollTop) => {
      const viewportBounds = element.getBoundingClientRect()
      const contentEndBounds = element.querySelector('.sponsorBlockFooter').getBoundingClientRect()
      const maximumScrollTop = Math.max(
        0,
        element.scrollTop + contentEndBounds.bottom - viewportBounds.bottom
      )
      return {
        scrollTopReduced: element.scrollTop < previousScrollTop,
        withinRenderedRange: element.scrollTop <= maximumScrollTop + 1
      }
    }, narrowScrollTop)).toEqual({
      scrollTopReduced: true,
      withinRenderedRange: true
    })

    await panel.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()
    await expect.poll(() => userInfoRequests).toBe(1)

    await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Refresh SponsorBlock information' }).click()
    await expect.poll(() => userInfoRequests).toBe(2)
    await expect(panel.locator('.sponsorBlockSegment')).toHaveCount(0)
    await expect.poll(() => content.evaluate((element) => {
      const scrollbar = element.querySelector('.os-scrollbar-vertical')
      const hasVerticalOverflow = element.scrollHeight > element.clientHeight + 1
      return {
        hasVerticalOverflow,
        hasVisibleScrollbar: scrollbar?.classList.contains('os-scrollbar-visible'),
        scrollTop: element.scrollTop
      }
    })).toEqual({
      hasVerticalOverflow: false,
      hasVisibleScrollbar: false,
      scrollTop: 0
    })
  })

  test('does not create a SponsorBlock user ID to load contribution stats', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    let userInfoRequests = 0
    await page.route('**/api/userInfo?*', (route) => {
      userInfoRequests++
      return route.abort()
    })
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
    })
    await openMockedVideo(page)
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()

    await expect(page.locator('.sponsorBlockContributionStats')).toContainText(
      'Submit a segment or import your SponsorBlock user ID to see contribution stats.'
    )
    expect(userInfoRequests).toBe(0)
  })

  test('uses a custom SponsorBlock category color for markers and prompts', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [{
          UUID: 'custom-color-sponsor',
          actionType: 'skip',
          category: 'sponsor',
          description: '',
          locked: 0,
          segment: [15, 20],
          videoDuration: 30,
          votes: 1
        }]
      }]),
      contentType: 'application/json'
    }))
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      store.commit('setSponsorBlockSponsor', { color: '#123456', skip: 'promptToSkip' })
    })

    await openMockedVideo(page)

    const marker = page.locator('.sponsorBlockMarker')
    await expect(marker).toHaveCount(1)
    await expect(marker).toHaveCSS('background-color', 'rgb(18, 52, 86)')

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 16
      element.dispatchEvent(new Event('timeupdate'))
    })
    const prompt = page.locator('.skippedSegment').filter({ hasText: 'Skip Sponsor?' })
    await expect(prompt).toBeVisible()
    await expect(prompt.locator('.skippedSegmentShield')).toHaveCSS('color', 'rgb(18, 52, 86)')
  })

  test('does not restore a SponsorBlock prompt when a skip remains inside the segment', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [{
          UUID: 'terminal-outro',
          actionType: 'skip',
          category: 'outro',
          description: '',
          locked: 0,
          segment: [15, 40],
          videoDuration: 40,
          votes: 1
        }]
      }]),
      contentType: 'application/json'
    }))
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
    })
    await openMockedVideo(page)

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 16
      element.dispatchEvent(new Event('timeupdate'))
    })

    const prompt = page.locator('.skippedSegment').filter({ hasText: 'Skip Endcards/Credits?' })
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: /Skip/ }).click()
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeLessThan(40)
    await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }))

    await expect(page.locator('.skippedSegment').filter({ hasText: 'Endcards/Credits Skipped' })).toBeVisible()
    await expect(prompt).toHaveCount(0)
  })

  test('previews and submits edited SponsorBlock timestamps', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    let submittedBody = null
    let userInfoRequests = 0

    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([]),
      contentType: 'application/json'
    }))
    await page.route('**/api/skipSegments', async route => {
      submittedBody = route.request().postDataJSON()
      await route.fulfill({
        body: JSON.stringify([{
          UUID: 'submitted-edited-segment',
          category: 'sponsor',
          segment: [11.722, 12]
        }]),
        contentType: 'application/json'
      })
    })
    await page.route('**/api/userInfo?*', async route => {
      userInfoRequests++
      await route.fulfill({
        body: JSON.stringify({
          segmentCount: userInfoRequests,
          viewCount: 0,
          minutesSaved: 0
        }),
        contentType: 'application/json'
      })
    })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      store.commit('setSponsorBlockGeneratedUserId', 'test-contributor')
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
    })

    await openMockedVideo(page)
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()
    await expect.poll(() => userInfoRequests).toBe(1)
    await page.locator('.watchVideoSponsorBlock').getByRole('button', { name: 'Close' }).click()

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 11
    })
    await page.locator('.sponsorblock-start-button').click({ force: true })
    await video.evaluate(element => { element.currentTime = 12 })
    await page.locator('.sponsorblock-end-button').click({ force: true })

    const submissionMenu = page.locator('.sponsorBlockSubmissionMenu')
    await submissionMenu.locator('.sponsorBlockDraftTimeInput').first().fill('0:11.722')
    await submissionMenu.getByRole('button', { name: 'Inspect' }).click()
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(11.722, 3)

    await video.evaluate(element => {
      const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
      Object.defineProperty(element, 'currentTime', {
        configurable: true,
        get: currentTime.get,
        set(value) {
          window.__sponsorBlockPreviewSeekTime ??= value
          currentTime.set.call(this, value)
        }
      })
    })
    await submissionMenu.getByRole('button', { name: 'Preview' }).click()
    await expect.poll(() => page.evaluate(() => window.__sponsorBlockPreviewSeekTime ?? null))
      .toBeCloseTo(9.722, 3)
    await video.evaluate(element => {
      element.currentTime = 11.8
      element.dispatchEvent(new Event('timeupdate'))
    })
    await submissionMenu.locator('.sponsorBlockSubmissionButton').click()

    await expect.poll(() => submittedBody).not.toBeNull()
    expect(submittedBody.segments).toEqual([{
      actionType: 'skip',
      category: 'sponsor',
      description: '',
      segment: [11.722, 12]
    }])

    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()
    await expect.poll(() => userInfoRequests).toBe(2)
  })

  test('skips SponsorBlock segments at their boundary without timeupdate events', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [{
          UUID: 'precise-skip-segment',
          actionType: 'skip',
          category: 'sponsor',
          description: '',
          locked: 0,
          segment: [15, 20],
          videoDuration: 30,
          votes: 1
        }]
      }]),
      contentType: 'application/json'
    }))
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
    })

    await openMockedVideo(page)
    await expect(page.locator('.sponsorBlockMarker')).toHaveCount(1)

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 14.57
      element.dispatchEvent(new Event('timeupdate'))

      const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
      Object.defineProperty(element, 'currentTime', {
        configurable: true,
        get: currentTime.get,
        set(value) {
          if (value === 20) {
            window.__sponsorBlockSkipStartedAt = currentTime.get.call(this)
          }
          currentTime.set.call(this, value)
        }
      })
      element.addEventListener('timeupdate', event => event.stopImmediatePropagation(), { capture: true })
      return element.play()
    })

    await expect.poll(() => page.evaluate(() => window.__sponsorBlockSkipStartedAt ?? null)).not.toBeNull()
    const skipStartedAt = await page.evaluate(() => window.__sponsorBlockSkipStartedAt)
    expect(skipStartedAt).toBeGreaterThanOrEqual(15)
    expect(skipStartedAt).toBeLessThan(15.05)
  })

  test('displays and submits full-video SponsorBlock labels', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const fullVideoSegment = {
      UUID: 'full-video-label',
      actionType: 'full',
      category: 'exclusive_access',
      description: '',
      locked: 0,
      segment: [0, 0],
      videoDuration: 19,
      votes: 1
    }
    let submittedBody = null

    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [fullVideoSegment]
      }]),
      contentType: 'application/json'
    }))
    await page.route('**/api/skipSegments', async route => {
      submittedBody = route.request().postDataJSON()
      await route.fulfill({
        body: JSON.stringify([{
          UUID: 'submitted-full-video-label',
          category: 'exclusive_access',
          segment: [0, 0]
        }]),
        contentType: 'application/json'
      })
    })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
    })

    await openMockedVideo(page)

    await expect(page.locator('.watchVideoInfo .videoBadge'))
      .toContainText('Exclusive Access · Full Video')

    await page.locator('.sponsorblock-start-button').click({ force: true })
    await page.locator('.sponsorblock-open-menu-button').click({ force: true })

    const submissionMenu = page.locator('.sponsorBlockSubmissionMenu')
    await expect(submissionMenu).toBeVisible()
    await submissionMenu.locator('select').first().selectOption('exclusive_access')
    await expect(submissionMenu.locator('select').nth(1)).toHaveValue('full')
    await expect(submissionMenu.locator('.sponsorBlockDraftTimeText')).toHaveText('Full Video')

    await submissionMenu.locator('.sponsorBlockSubmissionButton').click()
    await expect.poll(() => submittedBody).not.toBeNull()
    expect(submittedBody.segments).toEqual([{
      actionType: 'full',
      category: 'exclusive_access',
      description: '',
      segment: [0, 0]
    }])
    await expect(page.locator('.sponsorBlockMarker')).toHaveCount(0)
  })
})

test.describe('fullscreen captions', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        defaultCaptionSettings: JSON.stringify({ fontScale: 1.5 })
      }
    }
  })

  test('keeps the configured caption size in fullscreen', async ({ app }) => {
    const { page } = app
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const player = page.locator('.ftVideoPlayer')
    await player.evaluate(element => {
      for (const className of ['shaka-text-container', 'shaka-speech-to-text-container']) {
        if (element.querySelector(`.${className}`)) continue

        const captions = document.createElement('div')
        captions.className = className
        element.append(captions)
      }
    })

    const captionContainers = player.locator(
      '.shaka-text-container, .shaka-speech-to-text-container'
    )
    await expect(captionContainers).toHaveCount(2)
    const windowedFontSizes = await captionContainers.evaluateAll(elements => {
      return elements.map(element => getComputedStyle(element).fontSize)
    })
    expect(windowedFontSizes).toEqual(['30px', '30px'])

    // The player is only a few hundred pixels tall here, so the captions scale down with it.
    await setWindowWidth(app, 400)
    await expect.poll(async () => captionContainers.evaluateAll(elements => {
      return elements.map(element => getComputedStyle(element).fontSize)
    })).not.toEqual(windowedFontSizes)

    const narrowFontSizes = await captionContainers.evaluateAll(elements => {
      return elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize))
    })
    for (const fontSize of narrowFontSizes) {
      expect(fontSize).toBeGreaterThan(30 * 0.45)
      expect(fontSize).toBeLessThan(30 * 0.75)
    }

    // Fullscreen makes the player tall again, so the configured size comes back.
    await setPlayerFullscreen(page, true)
    await expect.poll(async () => captionContainers.evaluateAll(elements => {
      return elements.map(element => getComputedStyle(element).fontSize)
    })).toEqual(windowedFontSizes)
  })
})

test.describe('fullscreen playlist dock', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        enableSubtitlesByDefault: true,
        uiRoundness: 200,
      },
      playlists: [FULLSCREEN_PLAYLIST],
      history: [{
        ...FULLSCREEN_PLAYLIST.videos[0],
        _id: 'jNQXAC9IVRw',
        watchProgress: 19,
        isWatched: true,
        timeWatched: Date.now(),
        isLive: false,
      }]
    }
  })

  async function openFullscreenPlaylistVideo(page, { enableQuickBookmark = false } = {}) {
    await page.locator(sel.sideNavLink('userplaylists')).first().evaluate(element => element.click())
    await expect(page).toHaveURL(/#\/userplaylists/)
    await page.getByRole('link', { name: FULLSCREEN_PLAYLIST.playlistName }).first().click()
    await expect(page).toHaveURL(new RegExp(`#\\/playlist\\/${FULLSCREEN_PLAYLIST_ID}`))
    if (enableQuickBookmark) {
      const enableButton = page.getByTitle('Enable Quick Bookmark With This Playlist')
      const enabledIndicator = page.getByTitle('Quick Bookmark Enabled')
      // Wait for either state before branching, isVisible() does not retry.
      await expect(enableButton.or(enabledIndicator).first()).toBeVisible()
      if (await enableButton.isVisible()) {
        await enableButton.click()
      }
      await expect(enabledIndicator).toBeVisible()
    }
    await page.getByRole('link', { name: FULLSCREEN_PLAYLIST.videos[0].title }).first().click()
    await expect(page).toHaveURL(
      new RegExp(`#\\/watch\\/jNQXAC9IVRw\\?.*playlistId=${FULLSCREEN_PLAYLIST_ID}`)
    )
  }

  test('does not duplicate the remove action for the Quick Bookmark playlist', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await openFullscreenPlaylistVideo(page, { enableQuickBookmark: true })

    const item = page.locator('.watchVideoPlaylist .playlistItem').first()
    await item.locator('.videoThumbnail').hover()
    await expect(item.locator('.trashIcon')).toHaveCount(1)
    await expect(item.locator('.quickBookmarkVideoIcon')).toHaveCount(0)
  })

  test('keeps positioned captions centered across playlist videos', async ({ app, page }) => {
    test.setTimeout(120_000)
    await mockPlayableWatchPage(app, page, { captionCueSettings: 'position:63% align:start' })
    await openMockedVideo(page)
    await openFullscreenPlaylistVideo(page)

    const player = page.locator('.ftVideoPlayer')
    const caption = player.locator('.shaka-text-container [translate="no"]')
    const expectCaptionCentered = async () => {
      await expect(caption).toBeVisible()
      await expect.poll(async () => {
        const [playerBounds, captionBounds] = await Promise.all([
          player.boundingBox(),
          caption.boundingBox(),
        ])
        if (!playerBounds || !captionBounds) return Number.POSITIVE_INFINITY

        return Math.abs(
          (playerBounds.x + playerBounds.width / 2) -
          (captionBounds.x + captionBounds.width / 2)
        )
      }).toBeLessThanOrEqual(1)
    }

    // The source cue must not override the configured anchor in the inline player either.
    await expectCaptionCentered()
    await setPlayerFullscreen(page, true)
    await expectCaptionCentered()

    for (let index = 1; index <= 9; index++) {
      await player.locator('.skip-next-button').click({ force: true })
      await expect(page).toHaveURL(new RegExp(
        `#\\/watch\\/playlist${String(index).padStart(3, '0')}\\?.*playlistId=${FULLSCREEN_PLAYLIST_ID}`
      ))
      await expectCaptionCentered()
    }
  })

  test('clamps the watch playlist after removing most entries', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await openFullscreenPlaylistVideo(page)

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenPlaylistToggle').click()
    await expect(page.locator('.fullscreenPlaylistTarget .watchVideoPlaylist')).toBeVisible()

    const playlist = page.locator('.fullscreenPlaylistTarget .watchVideoPlaylist')
    const scroller = playlist.locator('.playlistItemsWrapper')
    const items = scroller.locator('.playlistItem')
    await expect(items).toHaveCount(FULLSCREEN_PLAYLIST.videos.length)
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await page.evaluate(async ({ playlistId, playlistItemIds }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('removeVideos', { _id: playlistId, playlistItemIds })
    }, {
      playlistId: FULLSCREEN_PLAYLIST_ID,
      playlistItemIds: FULLSCREEN_PLAYLIST.videos.slice(4).map(video => video.playlistItemId)
    })
    await expect(items).toHaveCount(4)
    await page.waitForTimeout(250)
    expect(await scroller.evaluate(element => element.scrollTop)).toBe(0)
  })

  test('keeps compact watched labels and playlist menus clear of other controls', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await openFullscreenPlaylistVideo(page)

    const playlist = page.locator('.watchVideoPlaylist.resizablePlaylist')
    const item = playlist.locator('.playlistItem').first()
    const thumbnail = item.locator('.videoThumbnail')
    const watched = thumbnail.locator('.videoWatched')
    const actions = thumbnail.locator('.playlistIcons')
    await expect(playlist).toBeVisible()
    await thumbnail.hover()
    await expect(watched).toBeVisible()
    await expect(actions).toBeVisible()
    const duration = thumbnail.locator('.videoDuration')
    await expect(watched).toHaveCSS('font-size', '12px')
    await expect(watched).toHaveCSS('border-radius', '10px')
    await expect(duration).toHaveCSS('font-size', '12px')
    await expect(duration).toHaveCSS('border-radius', '10px')

    const [watchedBox, actionsBox] = await Promise.all([
      watched.boundingBox(),
      actions.boundingBox(),
    ])
    expect(
      watchedBox.x + watchedBox.width <= actionsBox.x ||
    actionsBox.x + actionsBox.width <= watchedBox.x ||
    watchedBox.y + watchedBox.height <= actionsBox.y ||
    actionsBox.y + actionsBox.height <= watchedBox.y
    ).toBe(true)

    const sponsorBlockLabel = thumbnail.locator('.sponsorBlockVideoLabel')
    await thumbnail.evaluate(element => {
      const watched = element.querySelector('.videoWatched')
      watched.style.display = 'none'
      watched.closest('.ft-list-item').classList.remove('watched')

      const label = element.querySelector('.videoDuration').cloneNode(false)
      label.className = 'sponsorBlockVideoLabel'
      const text = document.createElement('span')
      text.textContent = 'Self-Promotion'
      for (const attribute of label.getAttributeNames()) {
        if (attribute.startsWith('data-v-')) {
          text.setAttribute(attribute, '')
        }
      }
      label.append(text)
      element.append(label)
    })
    await expect(sponsorBlockLabel).toBeVisible()
    const [sponsorBlockBox, durationBox, currentActionsBox] = await Promise.all([
      sponsorBlockLabel.boundingBox(),
      duration.boundingBox(),
      actions.boundingBox(),
    ])
    expect(sponsorBlockBox.y).toBeGreaterThan(
      currentActionsBox.y + currentActionsBox.height
    )
    expect(sponsorBlockBox.x + sponsorBlockBox.width).toBeLessThanOrEqual(durationBox.x)

    const addToPlaylist = item.locator('.addToPlaylistIcon .iconButton')
    await addToPlaylist.click()
    const dropdown = page.locator('.app > .iconDropdown.portal')
    await expect(dropdown).toBeVisible()
    const [buttonBox, dropdownBox] = await Promise.all([
      addToPlaylist.boundingBox(),
      dropdown.boundingBox(),
    ])
    expect(dropdownBox.y + dropdownBox.height).toBeLessThanOrEqual(buttonBox.y)
    expect(dropdownBox.x).toBeGreaterThanOrEqual(8)
    expect(dropdownBox.x + dropdownBox.width).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth - 8)
    )
    expect(await dropdown.evaluate(element => element.parentElement?.classList.contains('app'))).toBe(true)
    await expect(dropdown).toHaveCSS(
      'font-family',
      await page.locator('.app').evaluate(element => getComputedStyle(element).fontFamily)
    )
    expect(await dropdown.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      ))
    })).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dropdown).toHaveCount(0)

    const moreOptions = item.locator('.optionsButton .iconButton')
    await moreOptions.click()
    await expect(dropdown).toBeVisible()
    await expect(dropdown).toHaveClass(/listVideoOptionsDropdown/)
    await expect(dropdown).toHaveCSS('font-size', '14px')
    await expect(dropdown).toHaveCSS('overflow-y', 'auto')
    const optionsDropdownBox = await dropdown.boundingBox()
    expect(optionsDropdownBox.y).toBeGreaterThanOrEqual(8)
    expect(optionsDropdownBox.y + optionsDropdownBox.height).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerHeight - 8)
    )
    expect(optionsDropdownBox.x).toBeGreaterThanOrEqual(8)
    expect(optionsDropdownBox.x + optionsDropdownBox.width).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth - 8)
    )
    expect(await dropdown.evaluate(element => element.parentElement?.classList.contains('app'))).toBe(true)
    await expect(moreOptions).toBeVisible()
  })
})

test('treats an empty comments response as no comments', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)

  let commentRequestCount = 0
  await page.route(/\/youtubei\/v1\/next/, (route, request) => {
    const body = JSON.parse(request.postData() ?? '{}')
    if (!body.continuation) {
      return route.fallback()
    }

    commentRequestCount++
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}'
    })
  })

  await openMockedVideo(page)
  await page.locator('.commentAutoLoadSentinel').scrollIntoViewIfNeeded()

  await expect(page.locator('.noCommentMsg')).toHaveText('There are no comments available for this video')
  await expect(page.locator('.toast', { hasText: 'Local API Error' })).toHaveCount(0)
  expect(commentRequestCount).toBe(1)
})

test('loads initial comments with the video when automatic pagination is enabled', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
  })
  // Initial comments must not depend on the later-page sentinel being visible.
  await page.addStyleTag({ content: '.commentAutoLoadSentinel { display: none !important; }' })

  await openMockedVideo(page)

  await expect(page.locator('.getCommentsTitle')).toHaveCount(0, { timeout: 5_000 })
  await expect(page.locator('.commentsTitle')).toBeVisible()
  await expect(page.locator('.getMoreComments')).toHaveCount(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('pauses automatic comment pagination while filtering', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)

  let commentRequestCount = 0
  await page.route(/\/youtubei\/v1\/next/, async (route, request) => {
    const body = JSON.parse(request.postData() ?? '{}')
    if (body.continuation) {
      commentRequestCount++
    }
    await route.fallback()
  })

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setGeneralAutoLoadMorePaginatedItemsEnabled', true)
  })
  await openMockedVideo(page)
  await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Filter loaded comments' }).click()
  await page.getByRole('checkbox', { name: 'From creator' }).click()
  const requestCountAfterFiltering = commentRequestCount

  await page.waitForTimeout(750)
  expect(commentRequestCount).toBe(requestCountAfterFiltering)
  await expect(page.locator('.getMoreComments')).toBeVisible()
})

async function expectCommentHeaderToolsAligned(page) {
  const commentHeaderActions = [
    page.getByRole('button', { name: 'Filter loaded comments' }),
    page.getByRole('button', { name: 'Reload Comments' })
  ]
  const actionCenters = await Promise.all(commentHeaderActions.map(action => (
    action.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.top + bounds.height / 2
    })
  )))
  expect(Math.max(...actionCenters) - Math.min(...actionCenters)).toBeLessThanOrEqual(1)

  const actionRightEdges = await Promise.all(commentHeaderActions.map(action => (
    action.evaluate(element => element.getBoundingClientRect().right)
  )))
  const sortControlLeft = await page.locator('.commentHeaderActions .select').evaluate(element => {
    return element.getBoundingClientRect().left
  })
  expect(Math.max(...actionRightEdges)).toBeLessThan(sortControlLeft)

  const commentHeaderBottom = await page.locator('.commentHeader').evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.bottom
  })
  const searchInputTop = await page.getByRole('searchbox', { name: 'Search loaded comments' }).evaluate(element => {
    return element.getBoundingClientRect().top
  })
  expect(searchInputTop - commentHeaderBottom).toBeGreaterThanOrEqual(7.5)
}

test.describe('manual comment loading', () => {
  // These drive the click-to-load path and the reply pagination on top of a
  // single loaded page, so they turn off the automatic pagination that would
  // otherwise load (and keep loading) the comments on its own.
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        generalAutoLoadMorePaginatedItemsEnabled: false
      }
    }
  })

  test('translates a comment and restores its original text', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCurrentLocale', 'de-DE')
    })

    let translationRequestCount = 0
    await page.route(/\/youtubei\/v1\/comment\/perform_comment_action/, route => {
      translationRequestCount++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          frameworkUpdates: {
            entityBatchUpdate: {
              mutations: [{
                payload: {
                  commentEntityPayload: {
                    translatedContent: {
                      content: 'Translated comment text'
                    }
                  }
                }
              }]
            }
          }
        })
      })
    })

    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const translatableComment = page.locator('.commentThread').filter({
      has: page.locator(':scope > .commentTranslation .commentTranslationButton')
    }).first()
    const comment = page.locator(`#${await translatableComment.getAttribute('id')}`)
    await expect(comment).toBeVisible()
    const commentText = comment.locator(':scope > .commentText')
    const originalText = await commentText.textContent()
    const translate = comment.locator(':scope > .commentTranslation .commentTranslationButton')

    await translate.click()

    await expect(commentText).toHaveText('Translated comment text')
    await translate.click()
    await expect(commentText).toHaveText(originalText)

    await translate.click()
    await expect(commentText).toHaveText('Translated comment text')
    expect(translationRequestCount).toBe(1)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCurrentLocale', 'fr-FR')
    })

    await expect(commentText).toHaveText(originalText)
    await translate.click()
    await expect(commentText).toHaveText('Translated comment text')
    expect(translationRequestCount).toBe(2)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCommentTranslationIgnoredLanguages', ['en'])
    })

    await expect(commentText).toHaveText(originalText)
    await expect(translate).toHaveCount(0)
  })

  test('does not offer to translate a comment already in the app language', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const englishComment = page.locator('.commentThread').filter({
      hasText: "We're so honored that the first ever YouTube video was filmed here!"
    })
    await expect(englishComment).toBeVisible()
    await expect(englishComment.locator(':scope > .commentTranslation .commentTranslationButton')).toHaveCount(0)
  })

  test('does not offer to translate comments in an ignored language', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await Promise.all([
        store.dispatch('updateCurrentLocale', 'de-DE'),
        store.dispatch('updateCommentTranslationIgnoredLanguages', ['en'])
      ])
    })

    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.commentTranslationButton')).toHaveCount(0)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCommentTranslationIgnoredLanguages', [])
    })
    await expect(page.locator('.commentTranslationButton').first()).toBeVisible()
  })

  test('disables comment translations globally and restarts detection when re-enabled', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCurrentLocale', 'de-DE')
    })

    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    const translationButtons = page.locator('.commentTranslationButton')
    await expect(translationButtons.first()).toBeVisible()

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateEnableCommentTranslations', false)
    })
    await expect(translationButtons).toHaveCount(0)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateEnableCommentTranslations', true)
    })
    await expect(translationButtons.first()).toBeVisible()
  })

  test('hides comment translation buttons through the distraction-free setting', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateCurrentLocale', 'de-DE')
    })

    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const translationButtons = page.locator('.commentTranslationButton')
    await expect(translationButtons.first()).toBeVisible()

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateHideCommentTranslationButtons', true)
    })
    await expect(translationButtons).toHaveCount(0)
  })

  test('identifies collapsed replies from the video uploader', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page, { ownerReply: true })
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.getMoreComments')).toHaveCount(1)

    const ownerReplyToggle = page.getByRole('button', {
      name: /replies from .+ and others/
    })
    await expect(ownerReplyToggle).toBeVisible()
    await expect(ownerReplyToggle.locator('.commentReplyOwnerThumbnail')).toBeVisible()
    await expect(ownerReplyToggle.locator('.commentReplyOwnerSeparator')).toHaveText('•')
    await expect(ownerReplyToggle.locator('.commentReplyToggleText')).toHaveText(/\d+ replies/)
    await expect(ownerReplyToggle).not.toContainText('from')
    await ownerReplyToggle.scrollIntoViewIfNeeded()
    await attachScreenshot('uploader reply indicator')
  })

  test('searches the comments loaded for the current video', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const comments = page.locator('.commentThread')
    const initialCommentCount = await comments.count()
    expect(initialCommentCount).toBeGreaterThan(1)

    await expect(page.getByRole('searchbox', { name: 'Search loaded comments' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    const searchFilter = page.getByRole('checkbox', { name: 'Search loaded comments' })
    await expect(searchFilter).toBeFocused()
    await searchFilter.click()
    const commentSearchInput = page.getByRole('searchbox', { name: 'Search loaded comments' })
    await expect(commentSearchInput).toBeFocused()
    await expect(page.locator('.commentTools .clearInputTextButton')).toHaveCount(0)
    await expectCommentHeaderToolsAligned(page)
    await commentSearchInput.fill('honored')

    const searchCancelButtonStyles = await page.evaluate(() => {
      const rules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
      const baseRule = rules.find(rule => (
        rule.selectorText?.includes('input[type="search"]::-webkit-search-cancel-button') &&
        !rule.selectorText.includes(':hover') &&
        !rule.selectorText.includes(':active')
      ))
      const hoverRule = rules.find(rule => rule.selectorText?.includes('::-webkit-search-cancel-button:hover'))

      return {
        appearance: baseRule?.style.getPropertyValue('-webkit-appearance'),
        backgroundColor: baseRule?.style.backgroundColor,
        blockSize: baseRule?.style.blockSize,
        hoverBackgroundColor: hoverRule?.style.backgroundColor,
        inlineSize: baseRule?.style.inlineSize,
        maskSize: baseRule?.style.maskSize
      }
    })
    expect(searchCancelButtonStyles).toEqual({
      appearance: 'none',
      backgroundColor: 'var(--secondary-text-color)',
      blockSize: '24px',
      hoverBackgroundColor: 'var(--primary-color)',
      inlineSize: '24px',
      maskSize: '12px 12px',
    })

    await expect(comments).toHaveCount(1)
    await expect(comments).toContainText("We're so honored that the first ever YouTube video was filmed here!")
    await expect(comments.locator('.commentText mark')).toHaveText('honored')
    await expect(page.getByText(`1 of ${initialCommentCount} loaded comments`)).toBeVisible()

    await commentSearchInput.fill('WahilPro')
    await expect(comments).toHaveCount(1)
    await expect(comments.locator('.commentAuthor mark')).toHaveText('WahilPro')
  })

  test('searches loaded replies and keeps their parent thread', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const thread = page.locator('.commentThread').first()
    await thread.locator('.commentReplyRootToggle button').click()
    const firstReply = thread.locator('.commentReplyContent').first()
    await expect(firstReply).toBeVisible({ timeout: 30_000 })
    const replyAuthor = await firstReply.locator('.commentAuthor').innerText()

    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    await page.getByRole('checkbox', { name: 'Search loaded comments' }).click()
    await page.getByRole('searchbox', { name: 'Search loaded comments' }).fill(replyAuthor)

    await expect(page.locator('.commentThread')).toHaveCount(1)
    await expect(page.locator('.commentReplyContent')).toHaveCount(1)
    await expect(page.locator('.commentReplyContent .commentAuthor mark')).toHaveText(replyAuthor)
  })

  test('filters comments with timestamps and keeps highlighted timestamps clickable', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { commentTimestamp: true })
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    await page.getByRole('checkbox', { name: 'Contains timestamps' }).click()
    await expect(page.locator('.commentThread')).toHaveCount(1)

    await page.getByRole('checkbox', { name: 'Search loaded comments' }).click()
    const search = page.getByRole('searchbox', { name: 'Search loaded comments' })
    await search.fill('0:05')
    const timestamp = page.locator('.commentThread .commentText a[data-time="5"]')
    await expect(timestamp.locator('mark')).toHaveText('0:05')

    const video = page.locator('video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 0
    })
    await timestamp.locator('mark').click()
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(5, 1)
  })

  test('keeps personal comment pins for the current video', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const pinnedComment = page.locator('.commentThread').filter({ hasText: 'Who is here today?' })
    await pinnedComment.getByRole('button', { name: 'Pin comment by @WahilPro' }).click()
    await expect(pinnedComment).toContainText('Pinned by you')
    await expect(pinnedComment.getByRole('button', { name: 'Unpin comment by @WahilPro' })).toHaveAttribute('aria-pressed', 'true')
    await expect(pinnedComment).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(pinnedComment.locator('.commentPersonalPin')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.commentThread').first()).toContainText('Who is here today?')

    const reloadResponse = page.waitForResponse(/\/youtubei\/v1\/next/, { timeout: 30_000 })
    await page.getByRole('button', { name: 'Reload Comments' }).click()
    await reloadResponse

    await expect(page.locator('.commentThread').first()).toContainText('Who is here today?')
    await expect(page.locator('.commentThread').first()).toContainText('Pinned by you')
  })

  test('keeps personal pins on loaded replies', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    let thread = page.locator('.commentThread').first()
    const parentAuthor = await thread.locator(':scope > .commentAuthorWrapper .commentAuthor').innerText()
    await thread.locator('.commentReplyRootToggle button').click()
    let firstReply = thread.locator('.commentReplyContent').first()
    await expect(firstReply).toBeVisible({ timeout: 30_000 })
    const replyAuthor = await firstReply.locator('.commentAuthor').innerText()
    await firstReply.getByRole('button', { name: `Pin comment by ${replyAuthor}` }).click()
    await expect(firstReply).toContainText('Pinned by you')
    await expect(thread.locator(':scope > .commentPersonalPin')).toContainText('A reply is pinned')
    await expect(thread.getByRole('button', { name: `Pin comment by ${parentAuthor}` })).toHaveAttribute('aria-pressed', 'false')

    const reloadResponse = page.waitForResponse(/\/youtubei\/v1\/next/, { timeout: 30_000 })
    await page.getByRole('button', { name: 'Reload Comments' }).click()
    await reloadResponse

    thread = page.locator('.commentThread').first()
    await expect(thread.locator(':scope > .commentPersonalPin')).toContainText('A reply is pinned')
    const parentPinButton = thread.getByRole('button', { name: `Pin comment by ${parentAuthor}` })
    await expect(parentPinButton).toHaveAttribute('aria-pressed', 'false')
    await thread.locator('.commentReplyRootToggle button').click()
    firstReply = thread.locator('.commentReplyContent').filter({ hasText: replyAuthor })
    const replyUnpinButton = firstReply.getByRole('button', { name: `Unpin comment by ${replyAuthor}` })
    await expect(replyUnpinButton).toHaveAttribute('aria-pressed', 'true')
    await expect(firstReply).toContainText('Pinned by you')

    await replyUnpinButton.click()
    await expect(thread.locator(':scope > .commentPersonalPin')).toHaveCount(0)
    await firstReply.getByRole('button', { name: `Pin comment by ${replyAuthor}` }).click()
    await expect(thread.locator(':scope > .commentPersonalPin')).toContainText('A reply is pinned')

    await parentPinButton.click()
    await expect(thread.locator(':scope > .commentPersonalPin')).toContainText('Pinned by you')
    await expect(thread.getByRole('button', { name: `Unpin comment by ${parentAuthor}` })).toHaveAttribute('aria-pressed', 'true')
  })

  test('filters loaded comments to the video creator', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Filter loaded comments' }).click()
    const creatorFilter = page.getByRole('checkbox', { name: 'From creator' })
    await expect(creatorFilter.locator('.commentCreatorFilterAvatar')).toHaveAttribute('src', /.+/)
    await creatorFilter.click()

    await expect(page.locator('.commentThread')).toHaveCount(1)
    await expect(page.locator('.commentThread')).toContainText('@jawed')
    await expect(page.locator('.commentThread')).toContainText('Hello')
  })

  test('applies the shortened view count setting to comment likes', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const commentLikes = page.locator('.commentThread')
      .filter({ hasText: "We're so honored" })
      .locator('.commentLikeCount')
    await expect(commentLikes).toContainText(/4\.6\s?m/i)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('updateShortenViewCounts', false)
    })
    await expect(commentLikes).toContainText('4,600,000')
  })

  test('renders whitespace-only zero like counts as zero', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { blankCommentLikes: true })
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const commentLikes = page.locator('.commentThread')
      .filter({ hasText: "We're so honored" })
      .locator('.commentLikeCount')
    await expect(commentLikes).toHaveText('0')
  })

  test.describe('comment filtering at 125% UI scale', () => {
    test.use({
      seed: {
        settings: {
          ...WATCH_PAGE_SEED,
          generalAutoLoadMorePaginatedItemsEnabled: false,
          uiScale: 125
        }
      }
    })

    test('clamps fullscreen comment scrolling after filtering', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)

      const loadComments = page.locator('.getCommentsTitle')
      await loadComments.scrollIntoViewIfNeeded()
      await loadComments.click()
      await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

      await page.getByRole('button', { name: 'Filter loaded comments' }).click()
      await page.getByRole('checkbox', { name: 'Search loaded comments' }).click()
      await expectCommentHeaderToolsAligned(page)
      await page.getByRole('searchbox', { name: 'Search loaded comments' }).press('Escape')

      await setPlayerFullscreen(page, true)
      await page.locator('.fullscreenCommentsToggle').click({ force: true })

      const dock = page.locator('.fullscreenCommentsOverlay.open')
      const scroller = dock.locator('.commentsContentWrapper')
      const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
      await dock.getByRole('button', { name: 'Filter loaded comments' }).click()
      await expect(dock.getByRole('checkbox', { name: 'From creator' }).locator('.commentCreatorFilterAvatar')).toHaveAttribute('src', /.+/)
      await dock.getByRole('button', { name: 'Filter loaded comments' }).click()
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

      await dock.getByRole('button', { name: 'Filter loaded comments' }).click()
      await dock.getByRole('checkbox', { name: 'Search loaded comments' }).click()
      await dock.getByRole('searchbox', { name: 'Search loaded comments' }).fill('honored')

      await expect(dock.locator('.commentThread')).toHaveCount(1)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    })
  })

  test('stale reply controls disappear after an empty final reply page', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    const comments = page.locator('.comment')
    const commentIndex = await comments.evaluateAll(elements => (
      elements.findIndex(element => element.querySelector('.commentReplyRootToggle'))
    ))
    expect(commentIndex).toBeGreaterThanOrEqual(0)
    const comment = comments.nth(commentIndex)
    const replyToggleRow = comment.locator('.commentReplyRootToggle')
    const replyToggle = replyToggleRow.locator('.commentReplyContinuationButton')
    await expect(replyToggle).toBeVisible()
    await expect(replyToggle).not.toContainText('View')
    await expect(replyToggle.locator('svg')).toBeVisible()
    expect(await replyToggleRow.evaluate(element => (
      getComputedStyle(element, '::before').borderInlineStartWidth
    ))).toBe('1px')
    expect(await comment.evaluate((element) => {
      const toggle = element.querySelector('.commentReplyRootToggle')
      const stemStyle = getComputedStyle(element, '::before')
      const connectorStyle = getComputedStyle(toggle, '::before')
      const stemBottom = element.getBoundingClientRect().bottom - Number.parseFloat(stemStyle.insetBlockEnd)
      const connectorTop = toggle.getBoundingClientRect().top +
        Number.parseFloat(connectorStyle.insetBlockStart)
      return Math.abs(stemBottom - connectorTop)
    })).toBeLessThanOrEqual(0.5)

    await page.route(/\/youtubei\/v1\/next/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        onResponseReceivedEndpoints: [{
          appendContinuationItemsAction: {
            targetId: 'comment-replies-item-stale'
          }
        }]
      })
    }), { times: 1 })

    await replyToggle.click()

    await expect(comment.locator('.commentReplyRootToggle')).toHaveCount(0)
    await expect(comment).not.toHaveClass(/commentThreadCollapsed/)
    await expect(comment.locator('.commentReplyBranch')).toHaveCount(0)
  })

  test('reloading fullscreen comments scrolls back to the first comment', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await waitForPlayback(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()
    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })

    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenCommentsToggle').click({ force: true })

    const comments = page.locator('.fullscreenCommentsOverlay .commentsContentWrapper')
    await expect(comments).toBeVisible()
    await expect.poll(async () => comments.evaluate((element) => element.scrollHeight)).toBeGreaterThan(500)

    // The end of the loaded comments: the offset the reloaded, shorter list has
    // no room for, so it used to leave the dock parked past its own content.
    await comments.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(async () => comments.evaluate((element) => element.scrollTop)).toBeGreaterThan(300)

    const [reloadResponse] = await Promise.all([
      page.waitForResponse(/\/youtubei\/v1\/next/, { timeout: 30_000 }),
      page.locator('.fullscreenCommentHeader').getByRole('button', { name: 'Reload Comments' }).click()
    ])
    expect(reloadResponse.ok()).toBe(true)
    await expect(page.locator('.fullscreenCommentsOverlay .comment').first()).toBeVisible({ timeout: 30_000 })

    // OverlayScrollbars reapplies its remembered offset once the new list has
    // rendered, so the position has to still be at the top a moment later.
    await page.waitForTimeout(1000)
    expect(await comments.evaluate((element) => element.scrollTop)).toBe(0)
  })
})
