import {
  abortUnmockedRequest,
  sel,
  setPlayerFullscreen,
  setWindowSize,
  test,
  expect
} from '../../helpers/app.mjs'
import { activeTab, findWatchComponent, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { POST_LIVE_AUDIO_URL, routePostLiveMedia } from '../../helpers/media.mjs'
import { WATCH_PAGE_SEED, mockMusicMediaType } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

async function scrollPlayerMenuToBottom(menu) {
  await menu.evaluate((element) => {
    element.style.blockSize = '180px'
    element.style.maxBlockSize = '180px'
    element.style.gridTemplateColumns = '1fr'
    element.scrollTop = element.scrollHeight
  })
  await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
}

async function expectPlayerMenuScrollState(menu, atEnd = true) {
  await expect.poll(() => menu.evaluate((element, expectAtEnd) => {
    const visibleButtons = [...element.children].filter(child => (
      child instanceof HTMLButtonElement && !child.classList.contains('shaka-hidden')
    ))
    const contentEnd = visibleButtons.at(-1)
    const viewportBounds = element.getBoundingClientRect()
    const contentEndBounds = contentEnd.getBoundingClientRect()
    const maximumScrollTop = Math.max(
      0,
      element.scrollTop + contentEndBounds.bottom - viewportBounds.bottom +
        Number.parseFloat(getComputedStyle(contentEnd).marginBlockEnd) +
        Number.parseFloat(getComputedStyle(element).paddingBottom)
    )
    const hasVerticalOverflow = maximumScrollTop > 1
    const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
    return {
      scrollPositionValid: expectAtEnd
        ? Math.abs(element.scrollTop - maximumScrollTop) <= 1
        : element.scrollTop <= maximumScrollTop + 1,
      scrollbarMatchesOverflow:
        scrollbar?.classList.contains('os-scrollbar-visible') === hasVerticalOverflow,
    }
  }, atEnd)).toEqual({ scrollPositionValid: true, scrollbarMatchesOverflow: true })
}

test('phone watch players square screen-edge corners and retain centered landscape rounding', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  let releaseMetadata
  const metadataPending = new Promise(resolve => { releaseMetadata = resolve })
  await page.route(/\/youtubei\/v1\/player|www\.youtube\.com\/watch\?/, async route => {
    await metadataPending
    await route.fallback()
  })
  await page.evaluate(() => window.$store.dispatch('updateUiRoundness', 200))
  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')

  const skeleton = page.locator('.videoPlayerPlaceholder.ft-shimmer')
  try {
    await expect(skeleton).toHaveCSS('border-radius', '24px')
    await page.locator('.tabBar').evaluate(element => { element.style.display = 'none' })
    await page.locator('.app').evaluate(element => {
      element.classList.remove('topTabs')
      element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
    })
    await setWindowSize(app, page, { width: 375, height: 812 })
    await expect(skeleton).toHaveCSS('border-radius', '0px')
  } finally {
    releaseMetadata()
  }

  await waitForPlayback(page)
  const player = page.locator('.ftVideoPlayer')
  await player.locator('video').evaluate(element => element.pause())
  for (const scale of [1, 1.25]) {
    await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
    for (const { width, height, radius } of [
      { width: 375, height: 812, radius: '0px' },
      { width: 667, height: 500, radius: '0px' },
      { width: 667, height: 375, radius: '24px' },
      { width: 812, height: 375, radius: '24px' }
    ]) {
      await page.setViewportSize({ width, height })
      // Centered landscape players keep rounding even when they touch the header.
      await expect(player).toHaveCSS('border-radius', radius)
      await expect.poll(() => player.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        return Math.abs(bounds.left) <= 1 && Math.abs(bounds.right - innerWidth) <= 1
      })).toBe(radius === '0px')
    }
  }

  await page.evaluate(() => window.ftElectron.setZoomFactor(1))
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.locator('.tabBar').evaluate(element => { element.style.display = '' })
  await page.locator('.app').evaluate(element => {
    element.classList.remove('capacitorPhoneLayout')
    element.classList.add('capacitorTabletLayout', 'topTabs')
  })
  await expect(player).toHaveCSS('border-radius', '24px')
  await page.locator('.app').evaluate(element => element.classList.remove('capacitorTabs', 'capacitorTabletLayout'))
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(player).toHaveCSS('border-radius', '24px')
})

test('watch page skeletons follow UI roundness before playback loads', async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page)
  let releaseMetadata
  const metadataPending = new Promise(resolve => { releaseMetadata = resolve })
  await page.route(/\/youtubei\/v1\/player|www\.youtube\.com\/watch\?/, async route => {
    await metadataPending
    await route.fallback()
  })

  try {
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    const skeleton = page.locator('.videoPlayerPlaceholder.ft-shimmer')
    const recommendations = page.locator('.recommendationsSkeleton')
    const comments = page.locator('.commentsSkeleton')
    await expect(skeleton).toBeVisible()
    await expect(recommendations).toBeVisible()
    await expect(comments).toBeVisible()
    await expect(comments.locator('.skeletonComment')).toHaveCount(4)
    await expect(comments).toHaveAttribute('aria-hidden', 'true')

    for (const roundness of [0, 100, 200]) {
      await page.evaluate(value => window.$store.dispatch('updateUiRoundness', value), roundness)
      await expect(skeleton).toHaveCSS('border-radius', `${12 * roundness / 100}px`)
      await expect(recommendations).toHaveCSS('border-radius', `${12 * roundness / 100}px`)
      await expect(comments).toHaveCSS('border-radius', `${12 * roundness / 100}px`)
    }
    await attachScreenshot('watch page skeletons at 200% roundness')

    await page.evaluate(() => window.$store.dispatch('updateHideComments', true))
    await expect(comments).toHaveCount(0)
    await page.evaluate(() => window.$store.dispatch('updateHideComments', false))
    await expect(comments).toBeVisible()
    await comments.scrollIntoViewIfNeeded()
    const waitForCommentsShimmer = () => expect.poll(() => comments.locator('.skeletonCommentAvatar').first()
      .evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.effect.getComputedTiming().progress > 0.4))).toBe(true)
    await waitForCommentsShimmer()
    await attachScreenshot('comments skeleton at 200% roundness')
    await page.setViewportSize({ width: 520, height: 900 })
    await expect(comments).toBeHidden()
    await page.setViewportSize({ width: 900, height: 900 })
    await expect(comments).toBeVisible()
    await comments.scrollIntoViewIfNeeded()
    await expect.poll(() => comments.evaluate(element => {
      const viewportWidth = document.documentElement.clientWidth
      return Math.max(...[element, ...element.querySelectorAll('.skeletonComment, .skeletonLine')]
        .map(child => {
          const bounds = child.getBoundingClientRect()
          return Math.max(-bounds.left, bounds.right - viewportWidth)
        }))
    })).toBeLessThanOrEqual(1)
    await waitForCommentsShimmer()
    await attachScreenshot('comments skeleton at narrow width')
    await page.setViewportSize({ width: 1600, height: 900 })
  } finally {
    releaseMetadata()
  }

  await waitForPlayback(page)
  await expect(page.locator('.videoPlayerPlaceholder.ft-shimmer')).toHaveCount(0)
  await expect(page.locator('.ftVideoPlayer')).toHaveCSS('border-radius', '24px')
  await expect(page.locator('.recommendationsSkeleton')).toHaveCount(0)
  await expect(page.locator('.watchVideoRecommendations')).toHaveCSS('border-radius', '24px')
  await expect(page.locator('.commentsSkeleton')).toHaveCount(0)
  await expect(page.locator('.commentsArea .card')).toBeVisible()
})

test('connection loss keeps the previous page covered while Watch is scrolled', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const tab = page.locator('.tabContent[aria-hidden="false"]')
  const previousPage = tab.locator('.browsingBehindWatch')
  await expect(previousPage).toHaveCount(1)

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
  })

  await expect(page.locator('.connectionStatus')).toBeVisible()
  await expect(page.locator('.watchPreviewHost')).toBeVisible()
  await expect(previousPage).toBeHidden({ timeout: 2000 })
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
})

for (const mode of ['combined', 'merged', 'fallback', 'late-failure', 'pending-extraction']) {
  const pendingExtraction = mode === 'pending-extraction'
  const merged = mode !== 'combined' && !pendingExtraction
  const fallback = mode === 'fallback'
  const lateFailure = mode === 'late-failure'
  test(`casts ${lateFailure ? 'a complete MP4 after a merged stream fails' : fallback ? 'a complete MP4 when FFmpeg is unavailable' : pendingExtraction ? 'a complete MP4 while higher-resolution extraction is pending' : merged ? 'separate high-resolution tracks' : 'a complete MP4 stream'} to a discovered DLNA device and returns to local playback`, async ({ app, page }) => {
    await app.electronApp.evaluate(({ ipcMain }, { merged, fallback, pendingExtraction }) => {
      globalThis.__dlnaCalls = []
      globalThis.__dlnaExtractionCalls = 0
      ipcMain.removeHandler('yt-dlp-get-playback-info')
      ipcMain.handle('yt-dlp-get-playback-info', () => {
        globalThis.__dlnaExtractionCalls++
        if (pendingExtraction) return new Promise(() => {})
        return {
          isLive: false,
          formats: merged
            ? [
                { url: 'https://example.test/video-1080.mp4', protocol: 'https', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', height: 1080 },
                { url: 'https://example.test/audio.m4a', protocol: 'https', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', formatId: '140' }
              ]
            : []
        }
      })
      ipcMain.removeHandler('dlna-discover')
      ipcMain.removeHandler('dlna-start')
      ipcMain.removeHandler('dlna-stop')
      ipcMain.removeHandler('dlna-recover')
      ipcMain.handle('dlna-recover', (_event, castId, payload) => {
        globalThis.__dlnaCalls.push({ action: 'stop', castId }, { action: 'start', payload })
        // Recovery stops the failed cast, which clears its failure.
        if (castId === globalThis.__dlnaFailedCastId) globalThis.__dlnaFailedCastId = null
        return { castId: 'recovered-cast', deviceName: 'Living room TV' }
      })
      ipcMain.removeHandler('dlna-has-failed')
      // Like the main process, report a failure only for the cast that failed.
      ipcMain.handle('dlna-has-failed', (_event, castId) => castId === globalThis.__dlnaFailedCastId)
      ipcMain.handle('dlna-discover', () => [{ id: 'living-room', name: 'Living room TV' }])
      ipcMain.handle('dlna-start', async (_event, payload) => {
        globalThis.__dlnaCalls.push({ action: 'start', payload })
        if (fallback && payload.audioUrl) {
          // Slow FFmpeg validation outlasts Chromium's transient user activation.
          await new Promise(resolve => setTimeout(resolve, 6000))
          // The main-process start now owns the authorized complete-MP4 retry.
          globalThis.__dlnaCalls.push({
            action: 'start',
            payload: {
              deviceId: payload.deviceId,
              mediaUrl: payload.fallbackMediaUrl,
              title: payload.title,
              startSeconds: payload.startSeconds
            }
          })
          return { castId: 'test-cast', deviceName: 'Living room TV', usedFallback: true }
        }
        return { castId: 'test-cast', deviceName: 'Living room TV' }
      })
      ipcMain.handle('dlna-stop', (_event, castId) => {
        globalThis.__dlnaCalls.push({ action: 'stop', castId })
        return true
      })
    }, { merged, fallback, pendingExtraction })
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    const view = await watchViewHandle(page)
    await view.evaluate(view => {
      view.legacyFormats = [{
        url: 'https://example.test/video.mp4',
        mimeType: 'video/mp4',
        qualityLabel: '360p',
        height: 360
      }]
    })

    const castButton = page.getByRole('button', { name: 'Cast to a DLNA device' })
    await expect(castButton).toHaveCount(0)
    await page.evaluate(() => window.$store.dispatch('updateShowDlnaCastButton', true))
    await expect(castButton).toBeVisible()
    await expect(page.locator('.videoOptions .dlnaCastControl')).toBeVisible()
    await expect(page.locator('.ftVideoPlayer .dlnaCastControl')).toHaveCount(0)
    await expect(castButton.locator('[data-icon="cast"]')).toBeVisible()
    const playerBottom = await page.locator('.ftVideoPlayer').evaluate(element => element.getBoundingClientRect().bottom)
    const castTop = await castButton.evaluate(element => element.getBoundingClientRect().top)
    expect(castTop).toBeGreaterThan(playerBottom)
    await page.evaluate(() => window.$store.dispatch('updateUiScale', 125))
    await expect.poll(async () => {
      const videoBottom = await page.locator('.ftVideoPlayer').evaluate(element => element.getBoundingClientRect().bottom)
      const buttonTop = await castButton.evaluate(element => element.getBoundingClientRect().top)
      return buttonTop > videoBottom
    }).toBe(true)
    await castButton.click()
    if (pendingExtraction) {
      await expect(page.getByRole('option', { name: 'Living room TV' })).toBeVisible({ timeout: 3000 })
      await castButton.click()
      await castButton.click()
      await expect(page.getByRole('option', { name: 'Living room TV' })).toBeVisible()
      expect(await app.electronApp.evaluate(() => globalThis.__dlnaExtractionCalls)).toBe(1)
      await page.screenshot({ path: test.info().outputPath('dlna-devices-while-extracting.png') })
    }
    await page.getByRole('option', { name: 'Living room TV' }).click()
    if (fallback) {
      // Renderer evaluate() calls grant a fresh user gesture in Playwright.
      // Observe the main process while waiting for the authorized fallback.
      await expect.poll(() => app.electronApp.evaluate(() => globalThis.__dlnaCalls.filter(call => call.action === 'start').length)).toBe(2)
    }
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
    if (pendingExtraction) {
      expect(await app.electronApp.evaluate(() => globalThis.__dlnaExtractionCalls)).toBe(1)
    }
    if (lateFailure) {
      await app.electronApp.evaluate(() => { globalThis.__dlnaFailedCastId = 'test-cast' })
      await expect.poll(() => app.electronApp.evaluate(() => globalThis.__dlnaCalls.filter(call => call.action === 'start').length)).toBe(2)
    }
    const calls = await app.electronApp.evaluate(() => globalThis.__dlnaCalls)
    expect(calls[0].action).toBe('start')
    expect(calls[0].payload.mediaUrl).toBe(merged ? 'https://example.test/video-1080.mp4' : 'https://example.test/video.mp4')
    expect(calls[0].payload.audioUrl).toBe(merged ? 'https://example.test/audio.m4a' : undefined)
    if (fallback || lateFailure) {
      const retry = calls.filter(call => call.action === 'start')[1]
      expect(retry.payload.mediaUrl).toBe('https://example.test/video.mp4')
      expect(retry.payload.audioUrl).toBeUndefined()
    }

    await castButton.click()
    await page.getByRole('option', { name: 'Stop casting' }).click()
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
    expect(await app.electronApp.evaluate(() => globalThis.__dlnaCalls.at(-1))).toEqual({
      action: 'stop', castId: lateFailure ? 'recovered-cast' : 'test-cast'
    })

    await video.evaluate(element => element.pause())
    await castButton.click()
    await page.getByRole('option', { name: 'Living room TV' }).click()
    if (fallback) {
      await expect.poll(() => app.electronApp.evaluate(() => globalThis.__dlnaCalls.filter(call => call.action === 'start').length)).toBe(4)
    }
    await expect(castButton).toHaveAttribute('aria-pressed', 'true')
    await castButton.click()
    await page.getByRole('option', { name: 'Stop casting' }).click()
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  })
}

test('hides the DLNA action while the playback source is pending', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const view = await watchViewHandle(page)
  await page.evaluate(() => window.$store.dispatch('updateShowDlnaCastButton', true))
  const castButton = page.getByRole('button', { name: 'Cast to a DLNA device' })
  await expect(castButton).toBeVisible()

  await view.evaluate(async view => {
    view.ytDlpStreamsPending = true
    await view.$nextTick()
  })
  await expect(page.locator('.ftVideoPlayer')).toHaveCount(0)
  await expect(castButton).toHaveCount(0)

  await view.evaluate(view => { view.ytDlpStreamsPending = false })
  await expect(castButton).toBeVisible()
})

test('right control pill fades with its icons in both directions', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  const result = await page.evaluate(async () => {
    const controls = document.querySelector('.shaka-controls-container')
    const panel = controls.querySelector('.shaka-controls-button-panel')
    const pill = panel.querySelector('.ft-right-control-glass')
    const snapshot = () => ({
      iconOpacity: Number(getComputedStyle(panel.querySelector('.shaka-overflow-menu-button > .shaka-ui-icon')).filter.match(/opacity\(([^)]+)\)/)[1]),
      pillOpacity: Number(getComputedStyle(pill).opacity)
    })
    const settle = async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await Promise.allSettled(controls.getAnimations({ subtree: true })
        .filter(animation => animation instanceof CSSTransition)
        .map(animation => animation.finished))
    }
    // Sample 150ms into the fades on a paused clock, so a slow timer cannot land after them.
    const sampleMidway = () => {
      const transitions = controls.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSTransition)
      for (const transition of transitions) {
        transition.pause()
        transition.currentTime = 150
      }
      const state = snapshot()
      for (const transition of transitions) transition.play()
      return state
    }
    controls.setAttribute('shown', 'true')
    await settle()
    controls.removeAttribute('shown')
    const disappearing = sampleMidway()
    await settle()
    controls.setAttribute('shown', 'true')
    const appearing = sampleMidway()
    await settle()
    return { appearing, disappearing }
  })
  for (const state of [result.appearing, result.disappearing]) {
    expect(state.iconOpacity).toBeGreaterThan(0)
    expect(state.iconOpacity).toBeLessThan(1)
    expect(Math.abs(state.pillOpacity - state.iconOpacity)).toBeLessThan(0.05)
  }
})

test('iOS inline player fits the picture within its height limit', { tag: '@scale' }, async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await page.addStyleTag({ path: 'src/renderer/helpers/iosSafeArea.css' })
  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs'))
  const player = page.locator(`${activeTab} .ftVideoPlayer`)

  for (const size of [{ width: 1080, height: 810 }, { width: 810, height: 1080 }, { width: 450, height: 850 }]) {
    await setWindowSize(app, page, size)
    await expect.poll(() => video.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const frame = element.parentElement.getBoundingClientRect()
      const ratio = element.videoWidth / element.videoHeight
      const pictureWidth = Math.min(bounds.width, bounds.height * ratio)
      return {
        frameFitsPicture: Math.abs(frame.width - pictureWidth) <= 1,
        contained: frame.left >= -1 && frame.right <= innerWidth + 1,
        withinHeightLimit: frame.height <= parseFloat(getComputedStyle(element.parentElement).maxBlockSize) + 1,
        uncropped: getComputedStyle(element).objectFit === 'contain'
      }
    })).toEqual({ frameFitsPicture: true, contained: true, withinHeightLimit: true, uncropped: true })
  }

  await setWindowSize(app, page, { width: 1080, height: 810 })
  for (const [width, height] of [[210, 90], [160, 90]]) {
    await video.evaluate(async (element, { width, height }) => {
      element.srcObject?.getTracks().forEach(track => track.stop())
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').fillRect(0, 0, width, height)
      element.srcObject = canvas.captureStream(10)
      await element.play()
    }, { width, height })
    await expect.poll(() => video.evaluate(element => [element.videoWidth, element.videoHeight]))
      .toEqual([width, height])
    await expect.poll(() => video.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Math.abs(bounds.width - bounds.height * element.videoWidth / element.videoHeight)
    })).toBeLessThanOrEqual(1)
  }
  await setPlayerFullscreen(page, true)
  await expect.poll(() => player.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return Math.abs(bounds.width - innerWidth) <= 1 && Math.abs(bounds.height - innerHeight) <= 1
  })).toBe(true)
  await setPlayerFullscreen(page, false)
  await expect.poll(() => video.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return Math.abs(bounds.width - bounds.height * element.videoWidth / element.videoHeight)
  })).toBeLessThanOrEqual(1)
  await video.evaluate(element => element.srcObject.getTracks().forEach(track => track.stop()))
})

for (const ios of [false, true]) {
  test(`reserves the player height when Shaka loads before video metadata${ios ? ' on iOS' : ''}`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    if (ios) {
      await page.addStyleTag({ path: 'src/renderer/helpers/iosSafeArea.css' })
      await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs'))
    }
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))

    let releaseMedia
    const mediaPending = new Promise(resolve => { releaseMedia = resolve })
    await page.route(/googlevideo\.com\/videoplayback/, async route => {
      await mediaPending
      await route.fallback()
    })

    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)

    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    await expect(player).toBeVisible({ timeout: 30_000 })
    await expect.poll(async () => {
      return await player.evaluate(element => {
        const video = element.querySelector('video')
        const bounds = element.getBoundingClientRect()
        return {
          hasReservedRatio: element.classList.contains('sixteenByNine'),
          metadataPending: video?.videoWidth === 0,
          geometryReserved: Math.abs(bounds.height - bounds.width * 9 / 16) <= 1,
        }
      })
    }).toEqual({
      hasReservedRatio: true,
      metadataPending: true,
      geometryReserved: true,
    })
    const pendingBounds = await player.boundingBox()
    expect(Math.abs(pendingBounds.height - pendingBounds.width * 9 / 16)).toBeLessThanOrEqual(1)

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async component => {
      component.refs.player.hasLoaded = true
      await new Promise(resolve => requestAnimationFrame(resolve))
    })
    await expect(player).toHaveClass(/sixteenByNine/)
    const shakaLoadedBounds = await player.boundingBox()
    expect(Math.abs(shakaLoadedBounds.height - pendingBounds.height)).toBeLessThanOrEqual(1)

    await player.evaluate(element => {
      window.__playerLoadingHeights = []
      const recordHeight = () => {
        window.__playerLoadingHeights.push(element.getBoundingClientRect().height)
      }
      window.__playerLoadingHeightObserver = new ResizeObserver(recordHeight)
      window.__playerLoadingHeightObserver.observe(element)
      recordHeight()
    })
    releaseMedia()
    await waitForPlayback(page)
    const loadingHeights = await player.evaluate((element) => {
      window.__playerLoadingHeightObserver.disconnect()
      return window.__playerLoadingHeights.filter(height => height > 0)
    })
    const maximumLoadingHeightChange = Math.max(...loadingHeights
      .map(height => Math.abs(height - pendingBounds.height)))
    expect(maximumLoadingHeightChange).toBeLessThanOrEqual(1)
    await expect.poll(async () => {
      const loadedBounds = await player.boundingBox()
      return Math.abs(loadedBounds.height - pendingBounds.height)
    }).toBeLessThanOrEqual(1)
  })
}

async function countDistinctVisualizerFrames(canvas) {
  return canvas.evaluate(async (element) => {
    const signatures = new Set()
    for (let sample = 0; sample < 5; sample++) {
      await new Promise(resolve => setTimeout(resolve, 80))
      const data = element.getContext('2d').getImageData(0, 0, element.width, element.height).data
      let signature = 0
      for (let index = 3; index < data.length; index += 4) {
        signature = (signature + data[index] * index) >>> 0
      }
      signatures.add(signature)
    }
    return signatures.size
  })
}

test('shows the channel avatar in the YouTube audio-only player', async ({ app, page, attachScreenshot }) => {
  await mockMusicMediaType(app, page, 'MUSIC_VIDEO_TYPE_ATV')
  await openMockedVideo(page)
  const surface = page.locator(`${activeTab} .musicAudioSurface`)
  await expect(surface).toBeVisible()
  const channelAvatar = page.locator(`${activeTab} .channelThumbnail`).first()
  const avatar = surface.locator('.musicAudioAvatar')
  expect(await avatar.count()).toBe(1)
  await expect(avatar).toHaveAttribute('src', await channelAvatar.getAttribute('src'))
  await expect.poll(() => avatar.evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
  await attachScreenshot('YouTube audio player channel avatar')
  for (const scale of [1, 1.25]) {
    await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
    for (const size of [{ width: 1280, height: 720 }, { width: 375, height: 667 }, { width: 667, height: 375 }]) {
      await page.setViewportSize(size)
      const bounds = await surface.boundingBox()
      const creator = await surface.locator('.musicAudioCreator').boundingBox()
      expect(creator.x).toBeGreaterThanOrEqual(bounds.x - 1)
      expect(creator.y).toBeGreaterThanOrEqual(bounds.y - 1)
      expect(creator.x + creator.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
      expect(creator.y + creator.height, `${size.width}×${size.height} at ${scale * 100}% UI scale`).toBeLessThanOrEqual(bounds.y + bounds.height + 1)
      if (scale === 1 && size.width === 375) await attachScreenshot('YouTube audio player compact creator information')
    }
  }
})

test('shows the audio-track player and custom visualizer for YouTube Music tracks', async ({ app, page, attachScreenshot }) => {
  await mockMusicMediaType(app, page, 'MUSIC_VIDEO_TYPE_ATV')
  await page.evaluate(async () => {
    const NativeAudioContext = window.AudioContext
    window.__musicVisualizerTestAudioContexts = []
    window.__musicVisualizerTestCapturedStreams = []
    window.AudioContext = new Proxy(NativeAudioContext, {
      construct(Target, args) {
        const context = Reflect.construct(Target, args)
        const createAnalyser = context.createAnalyser.bind(context)
        context.createAnalyser = (...analyserArgs) => {
          const analyser = createAnalyser(...analyserArgs)
          const readFrequencyData = analyser.getByteFrequencyData.bind(analyser)
          let frame = 0
          analyser.getByteFrequencyData = (data) => {
            readFrequencyData(data)
            if (context.state === 'running') {
              data.fill(32 + (frame++ * 37) % 192)
            }
          }
          return analyser
        }
        window.__musicVisualizerTestAudioContexts.push(context)
        return context
      }
    })

    const captureStream = HTMLMediaElement.prototype.captureStream
    HTMLMediaElement.prototype.captureStream = function (...args) {
      const sourceStream = captureStream.apply(this, args)
      let capturedStream = sourceStream
      if (window.__musicVisualizerTestCapturedStreams.length === 0) {
        window.__musicVisualizerTestReplacementTrack = sourceStream.getAudioTracks()[0].clone()
      } else {
        capturedStream = new MediaStream(sourceStream.getVideoTracks())
        setTimeout(() => {
          const track = window.__musicVisualizerTestReplacementTrack
          capturedStream.addTrack(track)
          capturedStream.dispatchEvent(new MediaStreamTrackEvent('addtrack', { track }))
        }, 100)
      }
      window.__musicVisualizerTestCapturedStreams.push(capturedStream)
      return capturedStream
    }

    const store = window.$store
    await Promise.all([
      store.dispatch('updateReducedMotion', 'off'),
      store.dispatch('updateUiScale', 125),
    ])
  })

  const video = await openMockedVideo(page)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const surface = player.locator('.musicAudioSurface')
  const canvas = surface.locator('.musicVisualizerCanvas')
  const artwork = surface.locator('img.musicAudioArtwork:not(.retryImagePlaceholder)')

  await expect(player).toHaveClass(/musicAudioPlayer/)
  await expect(surface).toBeVisible()
  await expect(artwork).toBeVisible()
  await expect(surface.locator('.musicAudioTitle')).toHaveText(/\S/)
  await expect(surface.locator('.musicAudioArtist')).toHaveText(/\S/)
  await expect(surface.locator('.musicAudioAvatar')).toBeVisible()
  await expect(video).toHaveCSS('opacity', '0')
  await expect(canvas).toBeVisible()

  const artworkSrc = await artwork.getAttribute('src')
  // A failed thumbnail falls back to the next smaller resolution. Hold that
  // request so the fixture cannot load it before the hidden state is checked.
  const fallbackRequests = []
  const fallbackPattern = /\/vi\/[^/]+\/sddefault\.jpg/
  await page.route(fallbackPattern, route => { fallbackRequests.push(route) })
  await artwork.dispatchEvent('error')
  await expect(artwork).toHaveAttribute('src', fallbackPattern)
  await expect(artwork).toBeHidden()
  await artwork.evaluate((element) => {
    element.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E'
  })
  await expect(artwork).toBeVisible()
  await page.unroute(fallbackPattern)
  await Promise.all(fallbackRequests.map(route => route.abort().catch(() => {})))
  await artwork.evaluate((element, src) => { element.src = src }, artworkSrc)
  await expect.poll(() => artwork.evaluate(element => element.naturalWidth)).toBeGreaterThan(0)

  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  const visualizerToggle = player.getByRole('button', { name: 'Music visualizer', exact: true })
  await expect(visualizerToggle).toBeVisible()
  await expect(visualizerToggle).toHaveAttribute('aria-pressed', 'true')
  await visualizerToggle.click()
  await expect(visualizerToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(canvas).toBeHidden()
  await visualizerToggle.click()
  await expect(visualizerToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas).toBeVisible()
  await page.keyboard.press('Escape')

  const seekBar = player.locator('.shaka-seek-bar-container')
  await player.hover()
  await seekBar.hover({ position: { x: 120, y: 4 } })
  await expect(player.locator('.shaka-player-ui-thumbnail-image-container')).toBeHidden()
  await expect(player.locator('.shaka-player-ui-thumbnail-time-container')).toBeVisible()

  await expect.poll(() => canvas.evaluate((element) => {
    const context = element.getContext('2d')
    return context && context.getImageData(0, 0, element.width, element.height)
      .data.some((channel, index) => index % 4 === 3 && channel > 0)
  }), { timeout: 10_000 }).toBe(true)
  await expect.poll(() => countDistinctVisualizerFrames(canvas)).toBeGreaterThan(1)

  const playbackTimeBeforeSuspension = await video.evaluate(element => element.currentTime)
  await page.evaluate(async () => {
    await window.__musicVisualizerTestAudioContexts.at(-1).suspend()
  })
  await expect.poll(() => page.evaluate(() => (
    window.__musicVisualizerTestAudioContexts.at(-1).state
  )), {
    timeout: 5_000,
    message: 'visualizer should recover when its audio context is suspended while media keeps playing'
  }).toBe('running')
  await expect.poll(() => video.evaluate(element => element.currentTime))
    .toBeGreaterThan(playbackTimeBeforeSuspension)
  await expect.poll(() => countDistinctVisualizerFrames(canvas)).toBeGreaterThan(1)

  const audioContextCount = await page.evaluate(() => (
    window.__musicVisualizerTestAudioContexts.length
  ))
  const capturedStreamCount = await page.evaluate(() => (
    window.__musicVisualizerTestCapturedStreams.length
  ))
  await expect.poll(() => page.evaluate(() => (
    window.__musicVisualizerTestCapturedStreams.at(-1).getAudioTracks().length
  ))).toBeGreaterThan(0)
  await page.evaluate(() => {
    const track = window.__musicVisualizerTestCapturedStreams.at(-1).getAudioTracks()[0]
    track.stop()
    track.dispatchEvent(new Event('ended'))
  })
  await expect.poll(() => page.evaluate(() => (
    window.__musicVisualizerTestCapturedStreams.length
  )), {
    message: 'visualizer should capture the media element again after its audio track ends'
  }).toBeGreaterThan(capturedStreamCount)
  await expect.poll(() => page.evaluate(() => (
    window.__musicVisualizerTestAudioContexts.length
  )), {
    message: 'visualizer should rebuild after its captured audio track ends'
  }).toBeGreaterThan(audioContextCount)
  await expect.poll(() => countDistinctVisualizerFrames(canvas)).toBeGreaterThan(1)

  await attachScreenshot('YouTube Music audio-track player')

  const [playerBounds, artworkBounds] = await Promise.all([
    player.boundingBox(),
    artwork.boundingBox(),
  ])
  expect(playerBounds).not.toBeNull()
  expect(artworkBounds).not.toBeNull()
  expect(artworkBounds.x).toBeGreaterThanOrEqual(playerBounds.x)
  expect(artworkBounds.y).toBeGreaterThanOrEqual(playerBounds.y)
  expect(artworkBounds.x + artworkBounds.width)
    .toBeLessThanOrEqual(playerBounds.x + playerBounds.width)
  expect(artworkBounds.y + artworkBounds.height)
    .toBeLessThanOrEqual(playerBounds.y + playerBounds.height)

  await video.evaluate(element => element.pause())
  await expect.poll(() => canvas.evaluate((element) => {
    const context = element.getContext('2d')
    return context && context.getImageData(0, 0, element.width, element.height)
      .data.some((channel, index) => index % 4 === 3 && channel > 0)
  })).toBe(false)

  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateReducedMotion', 'on')
  })
  await video.evaluate(element => element.play())
  await expect(canvas).toBeHidden()
})

for (const { label, musicVideoType } of [
  { label: 'official music videos', musicVideoType: 'MUSIC_VIDEO_TYPE_OMV' },
  { label: 'Music category videos without a YouTube Music type', musicVideoType: undefined },
]) {
  test(`keeps ${label} in the video player`, async ({ app, page }) => {
    await mockMusicMediaType(app, page, musicVideoType)
    const video = await openMockedVideo(page)
    const player = page.locator(`${activeTab} .ftVideoPlayer`)

    await expect(player).not.toHaveClass(/musicAudioPlayer/)
    await expect(player.locator('.musicAudioSurface')).toHaveCount(0)
    await expect(video).toHaveCSS('opacity', '1')
  })
}

test('detects Invidious audio tracks from artist topic channels', async ({ page }) => {
  const instanceUrl = 'https://invidious.test'
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await routePostLiveMedia(page)
  await page.route(`${instanceUrl}/api/v1/videos/**`, route => route.fulfill({
    json: {
      title: 'Invidious audio track',
      viewCount: 1,
      paid: false,
      subCountText: '1',
      likeCount: 1,
      dislikeCount: 0,
      genre: 'Music',
      keywords: [],
      author: 'Example Artist - Topic',
      authorId: 'UC-example-artist-topic',
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
      lengthSeconds: 1,
      formatStreams: [],
      adaptiveFormats: [{
        itag: 140,
        url: `${POST_LIVE_AUDIO_URL}&dur=1`,
        type: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: '128000',
        init: '0-700',
        index: '701-800',
        audioQuality: 'AUDIO_QUALITY_MEDIUM',
        audioSampleRate: '48000',
        audioChannels: 2,
      }],
      videoThumbnails: [{ url: '/vi/jNQXAC9IVRw/hqdefault.jpg', width: 480, height: 360 }],
    }
  }))
  await page.evaluate(async (url) => {
    const store = window.$store
    await Promise.all([
      store.dispatch('updateBackendPreference', 'invidious'),
      store.dispatch('updateDefaultInvidiousInstance', url),
      store.dispatch('updateHideChapters', true),
    ])
  }, instanceUrl)

  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.infoArea .videoTitle')).toHaveText('Invidious audio track')
  const watchView = await watchViewHandle(page)
  await expect.poll(() => watchView.evaluate(view => view.musicMediaType)).toBe('audioTrack')
  await watchView.dispose()
})

test('updates boolean settings from the player options', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateShowSkipSilenceButton', true)
  })
  await openMockedVideo(page)

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  await player.getByRole('button', { name: 'More settings' }).click()
  const ambientMode = player.getByRole('button', { name: 'Ambient Mode', exact: true })
  const skipSilence = player.getByRole('button', { name: 'Skip Silence', exact: true })

  await expect(ambientMode).toHaveAttribute('aria-pressed', 'false')
  await ambientMode.click()
  await expect(ambientMode).toHaveAttribute('aria-pressed', 'true')
  await expect(skipSilence).toHaveAttribute('aria-pressed', 'false')
  await skipSilence.click()
  await expect(skipSilence).toHaveAttribute('aria-pressed', 'true')
})

test('toggles the quick bookmark and opens the playlist prompt with keyboard shortcuts', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  const isBookmarked = () => page.evaluate(() => window.$store.getters.getQuickBookmarkVideoIds.has('jNQXAC9IVRw'))
  expect(await isBookmarked()).toBe(false)
  await page.keyboard.press('b')
  await expect.poll(isBookmarked).toBe(true)
  await page.keyboard.press('b')
  await expect.poll(isBookmarked).toBe(false)

  const prompt = page.getByRole('dialog', { name: 'Select a playlist to add your video to', exact: true })
  await page.keyboard.press('Shift+S')
  await expect(prompt).toBeVisible()
  await expect(prompt.getByText('Favorites', { exact: true })).toBeVisible()
  // The prompt blocks player shortcuts, so pressing B again leaves the bookmark untouched.
  await prompt.getByRole('button', { name: 'Cancel', exact: true }).focus()
  await page.keyboard.press('b')
  await page.keyboard.press('Escape')
  await expect(prompt).toHaveCount(0)
  expect(await isBookmarked()).toBe(false)
})

test('marks the chapters player-option tile active while chapters are open', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await setWindowSize(app, page, { width: 480, height: 800 })
  await page.locator('.app').evaluate(element => {
    element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
  })

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate(async (component) => {
    component.proxy.videoChapters = [{
      title: 'Opening',
      startSeconds: 0,
      endSeconds: 30,
    }]
    await component.proxy.$nextTick()
  })

  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  const chapters = player.locator('.shaka-overflow-menu .ft-chapters-button')
  await expect(chapters).toHaveAttribute('aria-expanded', 'false')
  const closedBackground = await chapters.evaluate(element => getComputedStyle(element).backgroundColor)

  await chapters.click()
  await page.mouse.move(0, 0)
  await expect(chapters).toHaveAttribute('aria-expanded', 'true')
  const openBackground = await chapters.evaluate(element => getComputedStyle(element).backgroundColor)

  expect(openBackground).not.toBe(closedBackground)
  await watchComponent.dispose()
})

test('repeats an A-B range and manages it from the player menu', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  const player = page.locator('.ftVideoPlayer')

  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
  await video.evaluate((element) => {
    element.pause()
    element.currentTime = 5.25
  })

  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  await player.getByRole('button', { name: /^Set repeat start/ }).click()

  await expect(player.locator('.abRepeatRange')).toHaveCount(0)
  const abRepeatPopup = player.locator('.valueChangePopup')
  await expect(abRepeatPopup.locator('.valueChangeCustomIcon')).toBeVisible()
  await expect.poll(() => abRepeatPopup.locator(':scope > span:last-child').evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return [...range.getClientRects()].filter(rect => rect.width > 0).length
  })).toBe(1)
  await expect(player.locator('.abRepeatMarkerA')).toHaveAttribute(
    'aria-label',
    'Adjust point A, currently 0:05.25'
  )

  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  const pendingRangeClearAction = player.getByRole('button', { name: /^Clear A-B repeat range/ })
  await expect(pendingRangeClearAction).toBeVisible()
  await pendingRangeClearAction.click()
  await expect(player.locator('.shaka-overflow-menu:not(.shaka-hidden)')).toBeVisible()
  await expect(player.locator('.abRepeatMarker')).toHaveCount(0)
  await player.getByRole('button', { name: /^Set repeat start/ }).click()

  await video.evaluate((element) => { element.currentTime = 4 })
  await page.keyboard.press('Shift+B')
  await expect(player.locator('.valueChangePopup')).toContainText('Point B must be after point A.')
  await expect(player.locator('.abRepeatMarker')).toHaveCount(1)
  await expect(player.locator('.abRepeatMarkerB')).toHaveCount(0)

  await video.evaluate((element) => { element.currentTime = 6.25 })
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  await expect(player.getByRole('button', { name: /^Clear A-B repeat range/ })).toBeVisible()
  await expect(player.locator('.ab-repeat-button .shaka-current-selection-span'))
    .toHaveText('A 0:05.25')
  await expect(player.getByRole('button', { name: /^Set repeat end/ })).toBeVisible()
  const overflowMenu = player.locator('.shaka-overflow-menu:not(.shaka-hidden)')
  const loopAction = overflowMenu.locator('.loop-button')
  const abRepeatAction = overflowMenu.locator('.ab-repeat-button')
  await expect(loopAction).toBeVisible()
  await scrollPlayerMenuToBottom(overflowMenu)
  await page.keyboard.press('Shift+B')
  await expect(overflowMenu).toBeVisible()
  await expect(loopAction).not.toBeVisible()
  await expectPlayerMenuScrollState(overflowMenu)

  const [loopIconPath, abRepeatIconPath, clearIconPath, sponsorBlockClearIconPath] = await Promise.all([
    loopAction.locator('svg path').getAttribute('d'),
    abRepeatAction.locator('svg path').getAttribute('d'),
    overflowMenu.locator('.ab-repeat-clear-button svg path').getAttribute('d'),
    player.locator('.sponsorblock-clear-button svg path').getAttribute('d'),
  ])
  expect(abRepeatIconPath).not.toBe(loopIconPath)
  expect(clearIconPath).not.toBe(sponsorBlockClearIconPath)

  await overflowMenu.evaluate((element) => {
    element.style.blockSize = ''
    element.style.maxBlockSize = ''
    element.style.gridTemplateColumns = ''
    element.scrollTop = 0
  })

  await abRepeatAction.click()
  await expect(overflowMenu).toBeVisible()
  await expect(abRepeatAction).toHaveAttribute('aria-pressed', 'false')
  await expect(abRepeatAction).toHaveAccessibleName('Resume A-B repeat')
  await expect(loopAction).not.toBeVisible()

  await abRepeatAction.click()
  await expect(overflowMenu).toBeVisible()
  await expect(abRepeatAction).toHaveAttribute('aria-pressed', 'true')
  await expect(abRepeatAction).toHaveAccessibleName('Pause A-B repeat')
  await expect(loopAction).not.toBeVisible()
  await page.keyboard.press('Escape')

  const markers = player.locator('.abRepeatMarker')
  await expect(markers).toHaveCount(2)
  await expect(player.locator('.abRepeatRange')).toHaveCount(1)
  const seekBar = player.locator('.shaka-seek-bar-container')
  const markerPositions = await markers.evaluateAll((elements) => elements.map(element => {
    const bounds = element.getBoundingClientRect()
    const seekBounds = element.closest('.shaka-seek-bar-container').getBoundingClientRect()
    return (bounds.left + bounds.width / 2 - seekBounds.left) / seekBounds.width
  }))
  expect(markerPositions[0]).toBeCloseTo(5.25 / 30, 2)
  expect(markerPositions[1]).toBeCloseTo(6.25 / 30, 2)
  await expect(seekBar).toBeVisible()

  const endHandle = player.locator('.abRepeatMarkerB')
  const [seekBounds, endHandleBounds] = await Promise.all([
    seekBar.boundingBox(),
    endHandle.boundingBox(),
  ])
  await page.mouse.move(
    endHandleBounds.x + endHandleBounds.width / 2,
    endHandleBounds.y + endHandleBounds.height / 2
  )
  await page.mouse.down()
  const expectedBoundaryTime = 6.5
  await page.mouse.move(
    seekBounds.x + seekBounds.width * (expectedBoundaryTime / 30),
    seekBounds.y + seekBounds.height / 2
  )
  await page.mouse.up()
  await expect(endHandle).toHaveAttribute('aria-label', /Adjust point B, currently 0:06\.5/)

  await video.evaluate((element) => { element.currentTime = 8 })
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(5.25, 2)

  await video.evaluate(async (element) => {
    const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
    Object.defineProperty(element, 'currentTime', {
      configurable: true,
      get: currentTime.get,
      set(value) {
        if (Math.abs(value - 5.25) < 0.001 && currentTime.get.call(this) > 5.25) {
          window.__abRepeatBoundaryTime = currentTime.get.call(this)
        }
        currentTime.set.call(this, value)
      }
    })
    element.currentTime = 5.75
    element.playbackRate = 2
    await element.play()
  })

  await expect.poll(() => page.evaluate(() => window.__abRepeatBoundaryTime ?? null)).not.toBeNull()
  const boundaryTolerance = 0.015
  expect(await page.evaluate(() => window.__abRepeatBoundaryTime)).toBeGreaterThan(expectedBoundaryTime - boundaryTolerance)

  // A busy renderer can stall real playback checks past point B. Step a fake
  // playback clock instead, so the check sees exactly when B is reached.
  // Blocking timeupdate leaves the boundary scheduler as the only checker.
  const boundarySeeks = await video.evaluate(async (element) => {
    let currentTime = 6.45
    const seeks = []
    const blockTimeupdate = event => event.stopImmediatePropagation()
    element.addEventListener('timeupdate', blockTimeupdate, { capture: true })
    Object.defineProperty(element, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: value => { seeks.push(value) }
    })
    await new Promise(resolve => setTimeout(resolve, 200))
    const early = [...seeks]
    currentTime = 6.49
    const deadline = performance.now() + 5000
    while (seeks.length === early.length && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 4))
    }
    delete element.currentTime
    element.removeEventListener('timeupdate', blockTimeupdate, { capture: true })
    return { early, seek: seeks[early.length] ?? null }
  })
  expect(boundarySeeks).toEqual({ early: [], seek: 5.25 })

  await video.evaluate(element => element.pause())
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  const clearAction = player.getByRole('button', { name: /^Clear A-B repeat range/ })
  await expect(clearAction).toBeVisible()
  const clearMenu = player.locator('.shaka-overflow-menu:not(.shaka-hidden)')
  await scrollPlayerMenuToBottom(clearMenu)
  await page.keyboard.press('Shift+X')
  await expect(player.locator('.shaka-overflow-menu:not(.shaka-hidden)')).toBeVisible()
  await expect(clearAction).not.toBeVisible()
  await expect(player.getByRole('button', { name: /^Set repeat start/ })).toBeVisible()
  await expect(clearMenu.locator('.loop-button')).toBeVisible()
  await expect(player.locator('.abRepeatMarker')).toHaveCount(0)
  await expect(player.locator('.abRepeatRange')).toHaveCount(0)
  await expectPlayerMenuScrollState(clearMenu, false)

  await player.getByRole('button', { name: /^Set repeat start/ }).click()
  await expect(player.locator('.abRepeatMarker')).toHaveCount(1)
  await openMockedVideo(page, 'aqz-KE-bpKQ')
  await expect(player.locator('.abRepeatMarker')).toHaveCount(0)
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click({ force: true })
  await expect(player.getByRole('button', { name: /^Set repeat start/ })).toBeVisible()
  await expect(player.getByRole('button', { name: /^Clear A-B repeat range/ })).not.toBeVisible()
})

test('keeps the B repeat marker visible and interactive at the end', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  const player = page.locator('.ftVideoPlayer')

  await video.evaluate((element) => {
    element.pause()
    element.currentTime = 5
    // Media duration can extend past the last seekable sample.
    Object.defineProperty(element, 'seekable', {
      configurable: true,
      get: () => ({ length: 1, start: () => 0, end: () => element.duration - 0.001 })
    })
  })
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click()
  await player.getByRole('button', { name: /^Set repeat start/ }).click()
  await video.evaluate(async (element) => {
    element.currentTime = element.duration - 0.1
    await element.play()
  })
  await expect.poll(() => video.evaluate(element => element.ended)).toBe(true)
  await player.hover()
  await player.getByRole('button', { name: 'More settings' }).click()
  await player.getByRole('button', { name: /^Set repeat end/ }).click()

  for (const zoom of [1, 1.25]) {
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    await player.hover()
    const marker = player.locator('.abRepeatMarkerB')
    await expect(marker).toBeVisible()
    await expect.poll(() => marker.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const label = getComputedStyle(element, '::after')
      const left = bounds.left + Number.parseFloat(label.left)
      const top = bounds.top + Number.parseFloat(label.top)
      const width = Number.parseFloat(label.width)
      const height = Number.parseFloat(label.height)
      return [left + 1, left + width - 1].every(x => (
        document.elementFromPoint(x, top + height / 2) === element
      ))
    })).toBe(true)
    await marker.click({ trial: true })
  }
})

test('repeats an A-B range when point B is at the end of the video', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  const player = page.locator('.ftVideoPlayer')

  await video.evaluate((element) => {
    element.pause()
    element.currentTime = 5
  })
  await page.keyboard.press('Shift+A')
  await video.evaluate((element) => { element.currentTime = element.duration })
  await page.keyboard.press('Shift+B')
  await expect(player.locator('.abRepeatMarker')).toHaveCount(2)

  const watchComponent = await page.evaluateHandle(findWatchComponent)
  await watchComponent.evaluate((component) => {
    const findPlayer = (vnode) => {
      if (vnode?.component?.type?.name === 'FtShakaVideoPlayer') return vnode.component
      if (vnode?.component?.subTree) {
        const match = findPlayer(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findPlayer(child)
          if (match) return match
        }
      }
      return null
    }
    const playerComponent = findPlayer(component.subTree)
    const onEnded = playerComponent.vnode.props.onEnded
    window.__abRepeatEndedEvents = 0
    playerComponent.vnode.props.onEnded = (...args) => {
      window.__abRepeatEndedEvents++
      return onEnded(...args)
    }
  })
  await video.evaluate((element) => {
    const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
    const play = element.play.bind(element)
    window.__abRepeatRestartTime = null
    window.__abRepeatPlayCalls = 0
    Object.defineProperty(element, 'currentTime', {
      configurable: true,
      get: currentTime.get,
      set(value) {
        if (Math.abs(value - 5) < 0.001) {
          window.__abRepeatRestartTime = value
        }
        currentTime.set.call(this, value)
      }
    })
    element.play = () => {
      window.__abRepeatPlayCalls++
      return play()
    }
    element.currentTime = element.duration
    element.dispatchEvent(new Event('ended'))
  })

  await expect.poll(() => page.evaluate(() => window.__abRepeatRestartTime)).toBeCloseTo(5, 2)
  await expect.poll(() => page.evaluate(() => window.__abRepeatPlayCalls)).toBe(1)
  expect(await page.evaluate(() => window.__abRepeatEndedEvents)).toBe(0)
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
})

test.describe('with A-B repeat disabled', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        disableAbRepeat: true
      }
    }
  })

  test('removes the control and ignores its shortcuts', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const player = page.locator('.ftVideoPlayer')

    await player.hover()
    await player.getByRole('button', { name: 'More settings' }).click({ force: true })
    await expect(player.locator('.ab-repeat-button')).toHaveCount(0)
    await expect(player.locator('.ab-repeat-clear-button')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+A')
    await expect(player.locator('.abRepeatMarker')).toHaveCount(0)
  })
})

test('keeps no seek history until it is turned on and forgets it when turned off', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const currentTime = () => video.evaluate(element => element.currentTime)
  const seekHistoryButton = player.locator('.shaka-overflow-menu .seek-history-button')
  const setSeekHistoryEnabled = enabled => page.evaluate(value => window.$store.dispatch('updateEnableSeekHistory', value), enabled)
  const jump = async () => {
    await video.evaluate((element) => {
      element.pause()
      element.currentTime = 1
    })
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('9')
    await expect.poll(currentTime).toBeCloseTo(27, 1)
  }
  const openOverflowMenu = async () => {
    await player.hover()
    await player.getByRole('button', { name: 'More settings' }).click({ force: true })
    await expect(player.locator('.shaka-overflow-menu:not(.shaka-hidden)')).toBeVisible()
  }

  await jump()
  await page.keyboard.press('Control+z')
  await openOverflowMenu()
  await expect(seekHistoryButton).toHaveCount(0)
  expect(await currentTime()).toBeCloseTo(27, 1)
  await page.keyboard.press('Escape')

  await setSeekHistoryEnabled(true)
  await expect(seekHistoryButton).toHaveCount(1)
  await jump()
  await openOverflowMenu()
  await expect(seekHistoryButton.locator('.shaka-current-selection-span')).toHaveText('1 position')
  await page.keyboard.press('Escape')

  await setSeekHistoryEnabled(false)
  await expect(seekHistoryButton).toHaveCount(0)
  await setSeekHistoryEnabled(true)
  await expect(seekHistoryButton).toHaveCount(1)
  await openOverflowMenu()
  await expect(seekHistoryButton).toBeHidden()
})

test.describe('with seek history enabled', () => {
  test.use({
    seed: {
      settings: {
        ...WATCH_PAGE_SEED,
        enableSeekHistory: true
      }
    }
  })

  test('returns to the positions left by seeking through the seek history', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    const currentTime = () => video.evaluate(element => element.currentTime)
    const popup = player.locator('.valueChangePopup')
    const seekHistoryButton = player.locator('.shaka-overflow-menu .seek-history-button')
    const entries = player.locator('.seek-history-menu .seek-history-entry')
    const entryLabels = entries.locator(':scope > span:first-child')
    const openOverflowMenu = async () => {
      await player.hover()
      await player.getByRole('button', { name: 'More settings' }).click({ force: true })
    }

    const watchComponent = await page.evaluateHandle(findWatchComponent)
    await watchComponent.evaluate(async (component) => {
      component.proxy.videoChapters = [
        { title: 'Opening', startSeconds: 0, endSeconds: 15 },
        { title: 'Ending', startSeconds: 15, endSeconds: 30 },
      ]
      await component.proxy.$nextTick()
    })
    await watchComponent.dispose()

    // Seeks the user didn't make, such as resuming playback, aren't jumps.
    await video.evaluate((element) => {
      element.pause()
      element.currentTime = 1
    })
    await openOverflowMenu()
    await expect(player.locator('.shaka-overflow-menu:not(.shaka-hidden)')).toBeVisible()
    await expect(seekHistoryButton).toBeHidden()
    await page.keyboard.press('Escape')

    await page.keyboard.press('9')
    await expect.poll(currentTime).toBeCloseTo(27, 1)

    await player.hover()
    const seekBarBounds = await player.locator('.shaka-seek-bar').boundingBox()
    await page.mouse.click(seekBarBounds.x + seekBarBounds.width * 0.1, seekBarBounds.y + seekBarBounds.height / 2)
    await expect.poll(currentTime).toBeLessThan(6)
    const clickedTime = await currentTime()
    const clickedTimestamp = `0:0${Math.floor(clickedTime)}`

    await openOverflowMenu()
    await expect(seekHistoryButton).toBeVisible()
    await expect(seekHistoryButton).toHaveAccessibleName('Seek history')
    // The icon follows the selected icon pack.
    const seekHistoryIcon = seekHistoryButton.locator(':scope > svg')
    await expect(seekHistoryIcon.locator('path')).not.toHaveCount(0)
    const materialIcon = await seekHistoryIcon.innerHTML()
    await page.evaluate(() => window.$store.dispatch('updateIconPack', 'remix'))
    await expect.poll(() => seekHistoryIcon.innerHTML()).not.toBe(materialIcon)
    await expect(seekHistoryIcon.locator('path')).not.toHaveCount(0)
    await expect(seekHistoryButton.locator('.shaka-current-selection-span')).toHaveText('2 positions')
    await seekHistoryButton.click()
    await expect(entryLabels).toHaveText(['0:27 · Ending', '0:01 · Opening'])
    await expect(entries.locator('.seek-history-left-at')).toHaveText(['moments ago', 'moments ago'])
    await entries.first().click()
    await expect.poll(currentTime).toBeCloseTo(27, 1)
    await page.keyboard.press('Escape')

    // Leaving the clicked position replaces the nearby 0:01 entry.
    await openOverflowMenu()
    await seekHistoryButton.click()
    await expect(entryLabels).toHaveText([`${clickedTimestamp} · Opening`, '0:27 · Ending'])
    await page.keyboard.press('Escape')

    // Returning to an entry is undone like any other jump.
    // The popup closes after two seconds, so check it before polling the time.
    await page.keyboard.press('Control+z')
    await expect(popup).toContainText(clickedTimestamp)
    await expect.poll(currentTime).toBeCloseTo(clickedTime, 1)
    await page.keyboard.press('Control+z')
    await expect(popup).toContainText('Nothing to undo')
    await expect.poll(currentTime).toBeCloseTo(clickedTime, 1)

    await page.keyboard.press('Control+Shift+z')
    await expect(popup).toContainText('0:27')
    await expect.poll(currentTime).toBeCloseTo(27, 1)
    await page.keyboard.press('Control+Shift+z')
    await expect(popup).toContainText('Nothing to redo')
    await expect.poll(currentTime).toBeCloseTo(27, 1)

    await openOverflowMenu()
    await seekHistoryButton.click()
    await expect(entryLabels).toHaveText(['0:27 · Ending', `${clickedTimestamp} · Opening`])
    await expect(entries.first()).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')

    // Reopening the menu updates how long ago each place was left.
    await page.evaluate(() => {
      const now = Date.now
      Date.now = () => now() + 330_000
    })
    await openOverflowMenu()
    await seekHistoryButton.click()
    await expect(entries.locator('.seek-history-left-at')).toHaveText(['5 minutes ago', '5 minutes ago'])
  })

  test('keeps a seek history for each video until the app closes', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    const player = page.locator(`${activeTab} .ftVideoPlayer`)
    const seekHistoryButton = player.locator('.shaka-overflow-menu .seek-history-button')
    const openOverflowMenu = async () => {
      await player.hover()
      await player.getByRole('button', { name: 'More settings' }).click({ force: true })
      await expect(player.locator('.shaka-overflow-menu:not(.shaka-hidden)')).toBeVisible()
    }

    await video.evaluate((element) => {
      element.pause()
      element.currentTime = 1
    })
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('9')
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(27, 1)

    await openMockedVideo(page, 'aqz-KE-bpKQ')
    await openOverflowMenu()
    await expect(seekHistoryButton).toBeHidden()
    await page.keyboard.press('Escape')

    await openMockedVideo(page)
    await openOverflowMenu()
    await expect(seekHistoryButton.locator('.shaka-current-selection-span')).toHaveText('1 position')
  })
})

test('mobile skip buttons flank the centered play button', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 450, height: 850 })
  await page.locator('.app').evaluate(element => element.classList.add('capacitorTabs', 'capacitorPhoneLayout'))

  const view = await watchViewHandle(page)
  await view.evaluate(async component => {
    component.$store.commit('addPlaylist', {
      _id: 'ft-playlist--mobile-skip-test',
      playlistName: 'Mobile skip test',
      videos: [
        { videoId: 'dQw4w9WgXcQ', playlistItemId: 'first', title: 'First' },
        { videoId: 'jNQXAC9IVRw', playlistItemId: 'middle', title: 'Middle' },
        { videoId: '9bZkp7q19f0', playlistItemId: 'last', title: 'Last' },
      ]
    })
    await component.$store.dispatch('updateUserPlaylistSortOrder', 'custom')
    await component.tabRouter.push({
      path: '/watch/jNQXAC9IVRw',
      query: { playlistId: 'ft-playlist--mobile-skip-test', playlistType: 'user', playlistItemId: 'middle' }
    })
  })
  await expect.poll(() => view.evaluate(component => component.canSkipToPreviousVideo && component.canSkipToNextVideo)).toBe(true)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const buttons = player.locator('.shaka-big-buttons-container')
  await player.hover()

  for (const zoom of [1, 0.95]) {
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    await expect(buttons.locator(':scope > button')).toHaveCount(3)
    await expect(player.locator('.shaka-controls-button-panel > .ft-shaka-skip-button')).toHaveCount(0)
    const bounds = await buttons.evaluate(container => [...container.querySelectorAll(':scope > button')].map(button => {
      const { x, y, width, height } = button.getBoundingClientRect()
      return { x, y, width, height }
    }))
    expect(bounds[0].width).toBeCloseTo(48, 0)
    expect(bounds[2].width).toBeCloseTo(48, 0)
    expect(bounds[0].height).toBeCloseTo(48, 0)
    expect(bounds[2].height).toBeCloseTo(48, 0)
    // Chromium can round fractional UI-scale geometry slightly below 64 CSS px.
    expect(bounds[1].width).toBeGreaterThanOrEqual(64 - 0.5)
    expect(Math.abs(bounds[1].width - bounds[1].height)).toBeLessThan(1)
    expect(bounds[0].x + bounds[0].width).toBeLessThan(bounds[1].x)
    expect(bounds[1].x + bounds[1].width).toBeLessThan(bounds[2].x)
    expect(Math.abs(bounds[0].y + bounds[0].height / 2 - (bounds[1].y + bounds[1].height / 2))).toBeLessThan(1)
    expect(Math.abs(bounds[2].y + bounds[2].height / 2 - (bounds[1].y + bounds[1].height / 2))).toBeLessThan(1)
  }

  const playCenter = await buttons.locator('.shaka-play-button').evaluate(button => {
    const bounds = button.getBoundingClientRect()
    return bounds.x + bounds.width / 2
  })
  await view.evaluate(async component => {
    await component.tabRouter.push({
      path: '/watch/dQw4w9WgXcQ',
      query: { playlistId: 'ft-playlist--mobile-skip-test', playlistType: 'user', playlistItemId: 'first' }
    })
  })
  await expect.poll(() => view.evaluate(component => !component.canSkipToPreviousVideo && component.canSkipToNextVideo)).toBe(true)
  await expect(buttons.locator(':scope > button')).toHaveCount(2)
  expect(await buttons.locator('.shaka-play-button').evaluate(button => {
    const bounds = button.getBoundingClientRect()
    return bounds.x + bounds.width / 2
  })).toBeCloseTo(playCenter, 1)

  await view.dispose()
})
