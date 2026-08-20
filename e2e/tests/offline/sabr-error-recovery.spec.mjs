import { goTo, sel, test, expect } from '../../helpers/app.mjs'
import { mockUnplayableWatchPage, watchHistoryEntry, watchViewHandle } from '../../helpers/watch.mjs'

// Mirror the module-level Watch constants, which cannot be imported here.
const MAX_SABR_ERROR_RECOVERIES = 3
const MAX_SABR_ERROR_RECOVERIES_PER_VIDEO = 8

test.use({
  seed: {
    history: [{ ...watchHistoryEntry, title: 'SABR test video' }]
  }
})

/**
 * Puts the mounted Watch view into "playing a SABR stream on DASH" state, then
 * replays a scripted sequence of critical player errors and playback progress
 * against it. Reload requests are recorded instead of performed, so the run
 * stays offline and deterministic.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<{ error: true } | { reloadRequest: true } | { playFor: number } | { seekTo: number }>} script
 * @param {{
 *   isLoading?: boolean,
 *   legacyFormats?: Array<object>,
 *   rejectReload?: boolean,
 *   enablePlaybackEngineFallback?: boolean
 * }} options
 */
function driveWatchView(page, script, options = {}) {
  return page.evaluate(async ({ steps, isLoading, legacyFormats, rejectReload, enablePlaybackEngineFallback }) => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') {
        return vnode.component.proxy
      }
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) {
      throw new Error('Unable to access the watch view')
    }

    // The state a video that is playing a SABR stream on the DASH format is in.
    watchView.errorMessage = ''
    watchView.isLoading = isLoading
    watchView.isLive = false
    watchView.isPostLiveDvr = false
    watchView.activeFormat = 'dash'
    watchView.manifestMimeType = 'application/sabr+json'
    watchView.manifestSrc = 'sabr://test'
    watchView.legacyFormats = legacyFormats

    const reloads = []
    watchView.performSabrReload = async (_payload, toastMessage) => {
      reloads.push(toastMessage)
      if (rejectReload) throw new Error('Synthetic SABR reload rejection')
    }

    if (enablePlaybackEngineFallback) {
      watchView.extractYtDlpPlaybackSource = async () => {
        watchView.activePlaybackEngine = 'yt-dlp'
        return true
      }
    } else {
      // Existing tests exercise the in-engine recovery chain in isolation.
      watchView.tryPlaybackEngineFallback = async () => false
    }

    // A critical, non-abort shaka error: the kind that walks the format
    // fallback chain. 1002 = BAD_HTTP_STATUS, category 1 = NETWORK.
    const criticalError = () => ({
      severity: 2,
      category: 1,
      code: 1002,
      data: ['https://example.invalid/sabr', 500]
    })

    // The real player emits timeupdate straight off the video element, roughly
    // four times a second, so playback is replayed here at that granularity.
    const TICK_SECONDS = 0.25
    let position = 0

    const formats = []
    for (const step of steps) {
      if (step.error) {
        await watchView.handlePlayerError(criticalError())
      } else if (step.reloadRequest) {
        await watchView.onPlayerReloadRequested({ wasPlaying: true })
      } else if (step.seekTo !== undefined) {
        position = step.seekTo
        watchView.handleTimeUpdate(position)
      } else {
        for (let played = 0; played < step.playFor; played += TICK_SECONDS) {
          position += TICK_SECONDS
          watchView.handleTimeUpdate(position)
        }
      }
      formats.push(watchView.activeFormat)
    }

    return {
      reloads,
      formats,
      finalFormat: watchView.activeFormat,
      activePlaybackEngine: watchView.activePlaybackEngine,
      playbackEngineFallbackAttempted: watchView.playbackEngineFallbackAttemptedForCurrentVideo,
      errorMessage: watchView.errorMessage
    }
  }, {
    steps: script,
    isLoading: options.isLoading ?? false,
    legacyFormats: options.legacyFormats ?? [{ itag: 18, qualityLabel: '360p', height: 360, width: 640, url: 'https://example.invalid/360p' }],
    rejectReload: options.rejectReload ?? false,
    enablePlaybackEngineFallback: options.enablePlaybackEngineFallback ?? false
  })
}

test('terminal built-in playback failure falls back to yt-dlp once', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [
    { error: true },
    { error: true },
    { error: true },
    { error: true },
    { error: true }
  ], { enablePlaybackEngineFallback: true })

  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES)
  expect(result.activePlaybackEngine).toBe('yt-dlp')
  expect(result.playbackEngineFallbackAttempted).toBe(true)
  expect(result.errorMessage).toBe('')
})

test('terminal yt-dlp playback failure restores the built-in source once', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await page.evaluate(async () => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') return vnode.component.proxy
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) throw new Error('Unable to access the watch view')

    watchView.errorMessage = ''
    watchView.isPostLiveDvr = false
    watchView.activeFormat = 'dash'
    watchView.activePlaybackEngine = 'yt-dlp'
    watchView.activePlaybackEngineVersion = 'test'
    watchView.playbackEngineFallbackTarget = null
    watchView.manifestSrc = 'data:application/dash+xml,yt-dlp'
    watchView.manifestMimeType = 'application/dash+xml'
    watchView.legacyFormats = []
    watchView.builtInPlaybackSource = {
      manifestSrc: null,
      manifestMimeType: 'application/dash+xml',
      sabrData: null,
      legacyFormats: [{ itag: 18 }],
      streamingDataExpiryDate: new Date(Date.now() + 60_000)
    }

    const error = { code: 1002, data: ['https://example.invalid/video', 500] }
    const firstFallback = await watchView.tryPlaybackEngineFallback(error)
    const secondFallback = await watchView.tryPlaybackEngineFallback(error)

    return {
      firstFallback,
      secondFallback,
      activePlaybackEngine: watchView.activePlaybackEngine,
      activePlaybackEngineVersion: watchView.activePlaybackEngineVersion,
      activeFormat: watchView.activeFormat,
      fallbackTarget: watchView.playbackEngineFallbackTarget,
      manifestSrc: watchView.manifestSrc,
      legacyFormatCount: watchView.legacyFormats.length
    }
  })

  expect(result).toEqual({
    firstFallback: true,
    secondFallback: false,
    activePlaybackEngine: 'built-in',
    activePlaybackEngineVersion: null,
    activeFormat: 'legacy',
    fallbackTarget: 'built-in',
    manifestSrc: null,
    legacyFormatCount: 1
  })
})

test('yt-dlp playback refreshes once then prefers built-in SABR over legacy', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await page.evaluate(async () => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') return vnode.component.proxy
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) throw new Error('Unable to access the watch view')

    watchView.errorMessage = ''
    watchView.isLoading = false
    watchView.isLive = false
    watchView.isPostLiveDvr = false
    watchView.activeFormat = 'dash'
    watchView.activePlaybackEngine = 'yt-dlp'
    watchView.activePlaybackEngineVersion = 'test'
    watchView.streamErrorReloadAttemptedForCurrentVideo = false
    watchView.playbackEngineFallbackAttemptedForCurrentVideo = false
    watchView.playbackEngineFallbackTarget = null
    watchView.manifestSrc = 'data:application/dash+xml,yt-dlp'
    watchView.manifestMimeType = 'application/dash+xml'
    watchView.legacyFormats = [{ itag: 18 }]
    watchView.builtInPlaybackSource = {
      manifestSrc: 'data:application/sabr+json,built-in',
      manifestMimeType: 'application/sabr+json',
      sabrData: { scheme: 'sabr-test' },
      legacyFormats: [],
      streamingDataExpiryDate: new Date(Date.now() + 60_000)
    }

    let refreshes = 0
    watchView.reloadView = async () => {
      refreshes++
    }
    let progressSaves = 0
    watchView.handleWatchProgressAutoSaveWhenProgressEnabled = () => {
      progressSaves++
    }

    const error = { code: 1002, data: ['https://example.invalid/video', 500] }
    await watchView.handlePlayerError(error)
    const engineAfterRefresh = watchView.activePlaybackEngine
    const formatAfterRefresh = watchView.activeFormat
    await watchView.handlePlayerError(error)
    const fallbackPlaybackEngine = watchView.activePlaybackEngine
    const fallbackFormat = watchView.activeFormat
    const fallbackManifestMimeType = watchView.manifestMimeType
    const fallbackSabrScheme = watchView.sabrData?.scheme

    watchView.activeFormat = 'dash'
    watchView.activePlaybackEngine = 'yt-dlp'
    watchView.playbackEngineFallbackAttemptedForCurrentVideo = false
    watchView.playbackEngineFallbackTarget = null
    watchView.manifestSrc = 'data:application/dash+xml,yt-dlp'
    watchView.manifestMimeType = 'application/dash+xml'
    watchView.legacyFormats = [{ itag: 18 }]
    watchView.builtInPlaybackSource = {
      manifestSrc: null,
      manifestMimeType: 'application/dash+xml',
      sabrData: null,
      legacyFormats: [],
      streamingDataExpiryDate: null
    }
    const emptyBuiltInFallbackApplied = await watchView.tryPlaybackEngineFallback(error)

    return {
      refreshes,
      progressSaves,
      engineAfterRefresh,
      formatAfterRefresh,
      fallbackPlaybackEngine,
      fallbackFormat,
      fallbackManifestMimeType,
      fallbackSabrScheme,
      emptyBuiltInFallbackApplied,
      engineAfterEmptyBuiltInFallback: watchView.activePlaybackEngine,
      legacyFormatCount: watchView.legacyFormats.length
    }
  })

  expect(result).toEqual({
    refreshes: 1,
    progressSaves: 1,
    engineAfterRefresh: 'yt-dlp',
    formatAfterRefresh: 'dash',
    fallbackPlaybackEngine: 'built-in',
    fallbackFormat: 'dash',
    fallbackManifestMimeType: 'application/sabr+json',
    fallbackSabrScheme: 'sabr-test',
    emptyBuiltInFallbackApplied: false,
    engineAfterEmptyBuiltInFallback: 'yt-dlp',
    legacyFormatCount: 1
  })
})

test('expired built-in playback source is refreshed before yt-dlp falls back', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await page.evaluate(async () => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') return vnode.component.proxy
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) throw new Error('Unable to access the watch view')

    watchView.errorMessage = ''
    watchView.isPostLiveDvr = false
    watchView.activePlaybackEngine = 'yt-dlp'
    watchView.playbackEngineFallbackTarget = null
    watchView.builtInPlaybackSource = {
      manifestSrc: 'https://example.invalid/expired.mpd',
      manifestMimeType: 'application/dash+xml',
      sabrData: null,
      legacyFormats: [],
      streamingDataExpiryDate: new Date(Date.now() - 1)
    }

    let reloadOptions = null
    watchView.reloadView = async (options) => {
      reloadOptions = options
      watchView.activePlaybackEngine = 'built-in'
      watchView.manifestSrc = 'https://example.invalid/refreshed.mpd'
    }

    const fallbackApplied = await watchView.tryPlaybackEngineFallback({
      code: 1002,
      data: ['https://example.invalid/video', 500]
    })

    watchView.activePlaybackEngine = 'yt-dlp'
    watchView.playbackEngineFallbackAttemptedForCurrentVideo = false
    watchView.playbackEngineFallbackTarget = null
    watchView.reloadView = async () => {
      throw new Error('Synthetic built-in source refresh rejection')
    }
    const rejectedFallbackApplied = await watchView.tryPlaybackEngineFallback({
      code: 1002,
      data: ['https://example.invalid/video', 500]
    })

    return {
      fallbackApplied,
      rejectedFallbackApplied,
      pendingAfterRejectedRefresh: watchView.ytDlpStreamsPending,
      reloadOptions,
      fallbackTarget: watchView.playbackEngineFallbackTarget,
      activePlaybackEngine: watchView.activePlaybackEngine,
      manifestSrc: watchView.manifestSrc
    }
  })

  expect(result).toEqual({
    fallbackApplied: true,
    rejectedFallbackApplied: false,
    pendingAfterRejectedRefresh: false,
    reloadOptions: { preserveTitle: true },
    fallbackTarget: 'built-in',
    activePlaybackEngine: 'yt-dlp',
    manifestSrc: 'https://example.invalid/refreshed.mpd'
  })
})

test('a SABR reload preserves the active video quality', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const quality = await page.evaluate(async () => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') {
        return vnode.component.proxy
      }
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) {
      throw new Error('Unable to access the watch view')
    }

    watchView.currentVideoQuality = '360'
    watchView.getTimestamp = () => 0
    watchView.reloadView = async () => {}
    watchView.showTabToast = () => {}

    await watchView.performSabrReload({ videoQuality: '720' }, 'Synthetic SABR reload')

    // Metadata loading normally resets this to the configured default before
    // initializeVideoQuality restores the state captured from the old player.
    watchView.currentVideoQuality = '360'
    watchView.initializeVideoQuality()

    return watchView.currentVideoQuality
  })

  expect(quality).toBe('720')
})

test('a SABR reload preserves the tab title while adding its resume timestamp', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const titles = await page.evaluate(async () => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') {
        return vnode.component.proxy
      }
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) {
      throw new Error('Unable to access the watch view')
    }

    watchView.getTimestamp = () => 42
    watchView.reloadView = async () => {}
    watchView.showTabToast = () => {}

    const titleBeforeReload = watchView.$store.getters.getTabById(watchView.tabId).contentTitle
    const publishedTitles = []
    const unsubscribe = watchView.$store.subscribe((mutation) => {
      if (mutation.type === 'setTabContentTitle' && mutation.payload.tabId === watchView.tabId) {
        publishedTitles.push(mutation.payload.title)
      }
    })

    try {
      await watchView.performSabrReload({}, 'Synthetic SABR reload')
    } finally {
      unsubscribe()
    }

    return { titleBeforeReload, publishedTitles }
  })

  expect(titles.publishedTitles).toEqual([titles.titleBeforeReload])
  await expect(page).toHaveURL(/oneTimeTimestamp=42/)
  await expect(page).toHaveTitle(`${titles.titleBeforeReload} - OpenTubeX`)
})

test('a background SABR refresh does not flash the tab loading indicator', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const watchView = await watchViewHandle(page)
  const watchTabId = await watchView.evaluate(view => view.tabId)
  const watchTab = page.locator(`.tab[data-tab-id="${watchTabId}"]`)
  const watchContent = page.locator(`.tabContent[data-tab-id="${watchTabId}"]`)
  const historyTab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/history',
    title: 'History',
    makeActive: false,
    preloadInBackground: true
  }))
  const historyTabElement = page.locator(`.tab[data-tab-id="${historyTab.id}"]`)
  await expect(page.locator(sel.tabs)).toHaveCount(2)

  await watchView.evaluate(view => {
    view.activeFormat = 'dash'
    view.manifestMimeType = 'application/sabr+json'
    view.manifestSrc = 'sabr://test'
    view.isLive = false
    view.isPostLiveDvr = false
    view.isLoading = false
    view.getTimestamp = () => 42
    view.showTabToast = () => {}
    view.handleRouteChange = async () => {
      window.__backgroundSabrRouteChangeStarted = true
      await new Promise(resolve => { window.__finishBackgroundSabrRouteChange = resolve })
    }
    view.getVideoInformationLocal = async () => {
      window.__backgroundSabrRefreshStarted = true
      await new Promise(resolve => { window.__finishBackgroundSabrMetadata = resolve })
      view.ytDlpStreamsPending = true
      view.isLoading = false
      window.__backgroundSabrStreamsStarted = true
      await new Promise(resolve => { window.__finishBackgroundSabrStreams = resolve })
      view.ytDlpStreamsPending = false
    }

    window.__backgroundSabrRouteChangeStarted = false
    window.__backgroundSabrRefreshStarted = false
    window.__backgroundSabrStreamsStarted = false
    window.__backgroundSabrRefreshPromise = null
    window.setTimeout(() => {
      window.__backgroundSabrRefreshPromise = view.onPlayerReloadRequested({ wasPlaying: true })
    }, 250)
  })

  try {
    await historyTabElement.click()
    await expect(historyTabElement).toHaveClass(/active/)
    await expect.poll(() => page.evaluate(() => window.__backgroundSabrRouteChangeStarted)).toBe(true)
    await watchView.evaluate(view => view.handleVideoLoaded({}))
    await expect(watchContent.locator('.videoLayout')).toHaveAttribute('data-tab-loading-suppressed', '')

    await page.evaluate(() => window.__finishBackgroundSabrRouteChange())
    await expect.poll(() => page.evaluate(() => window.__backgroundSabrRefreshStarted)).toBe(true)
    await expect(watchContent.locator('.videoPlayerPlaceholder')).toHaveCount(1)
    await expect(watchContent.locator('.videoLayout')).toHaveAttribute('data-tab-loading-suppressed', '')
    await expect(watchContent.locator('[data-tab-loading-indicator]')).not.toHaveCount(0)
    await expect(watchTab).not.toHaveClass(/loading/)

    await page.evaluate(() => window.__finishBackgroundSabrMetadata())
    await expect.poll(() => page.evaluate(() => window.__backgroundSabrStreamsStarted)).toBe(true)
    await expect(watchContent.locator('.streamPlaceholder')).toHaveCount(1)
    await expect(watchContent.locator('.videoLayout')).toHaveAttribute('data-tab-loading-suppressed', '')
    await expect(watchContent.locator('[data-tab-loading-indicator]')).not.toHaveCount(0)
    await expect(watchTab).not.toHaveClass(/loading/)

    await watchView.evaluate(view => { view.suppressTabLoadingIndicator = false })
    await expect(watchContent.locator('.videoLayout')).not.toHaveAttribute('data-tab-loading-suppressed', '')
    await page.waitForTimeout(250)
    await expect(watchContent.locator('[data-tab-loading-indicator]')).not.toHaveCount(0)
    await expect(watchTab).not.toHaveClass(/loading/)

    await watchView.evaluate(view => { view.videoLoadGeneration++ })
    await expect(watchTab).toHaveClass(/loading/)

    await page.evaluate(async () => {
      window.__finishBackgroundSabrStreams()
      await window.__backgroundSabrRefreshPromise
    })
    await expect(watchContent.locator('[data-tab-loading-indicator]')).toHaveCount(0)

    await watchView.evaluate(view => { view.isLoading = true })
    await expect(watchTab).toHaveClass(/loading/)
    await watchView.evaluate(view => { view.isLoading = false })
    await expect(watchTab).not.toHaveClass(/loading/)
  } finally {
    await page.evaluate(async () => {
      window.__finishBackgroundSabrRouteChange?.()
      window.__finishBackgroundSabrMetadata?.()
      await new Promise(resolve => window.setTimeout(resolve, 0))
      window.__finishBackgroundSabrStreams?.()
      await window.__backgroundSabrRefreshPromise
    })
    await watchView.dispose()
  }
})

test('a second SABR failure after successful playback refetches instead of dropping to legacy', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [
    { error: true },
    // The refreshed stream plays well past the settle threshold.
    { playFor: 60 },
    // An unrelated failure much later in the same video.
    { error: true }
  ])

  expect(result.reloads).toEqual([
    'Refreshing SABR stream after playback error',
    'Refreshing SABR stream after playback error'
  ])
  expect(result.finalFormat).toBe('dash')
})

test('SABR failures that never settle fall back to legacy but never audio', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  // Four back-to-back failures with no playback progress in between.
  const result = await driveWatchView(page, [
    { error: true },
    { error: true },
    { error: true },
    { error: true },
    { error: true }
  ])

  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES)
  expect(result.formats).toEqual(['dash', 'dash', 'dash', 'legacy', 'legacy'])
  expect(result.errorMessage).toContain('Unable to recover the video stream')
})

test('repeated SABR reload requests stop instead of reloading the tab forever', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [
    { reloadRequest: true },
    { reloadRequest: true },
    { reloadRequest: true },
    { reloadRequest: true }
  ])

  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES)
  expect(result.formats).toEqual(['dash', 'dash', 'dash', 'legacy'])
  expect(result.finalFormat).toBe('legacy')
})

test('repeated SABR reload requests never fall back to audio', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [
    { reloadRequest: true },
    { reloadRequest: true },
    { reloadRequest: true },
    { reloadRequest: true }
  ], { legacyFormats: [] })

  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES)
  expect(result.finalFormat).toBe('dash')
  expect(result.errorMessage).toContain('Unable to recover the video stream')
})

test('a SABR failure refetches when no 360p fallback is available', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [{ error: true }], { legacyFormats: [] })

  expect(result.reloads).toEqual(['Refreshing SABR stream after playback error'])
  expect(result.finalFormat).toBe('dash')
})

test('repeated SABR failures without a legacy fallback never switch to audio', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [
    { error: true },
    { error: true },
    { error: true },
    { error: true }
  ], { legacyFormats: [] })

  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES)
  expect(result.formats).toEqual(['dash', 'dash', 'dash', 'dash'])
  expect(result.finalFormat).toBe('dash')
  expect(result.errorMessage).toContain('Unable to recover the video stream')

  const errorPlayer = page.locator('.videoPlayerError')
  await expect(errorPlayer).toBeVisible()
  await expect(errorPlayer.locator('.videoThumbnail')).toHaveAttribute('src', /\S+/)

  const [playerBounds, infoBounds] = await Promise.all([
    errorPlayer.boundingBox(),
    page.locator('.infoArea').boundingBox()
  ])
  expect(playerBounds.width / playerBounds.height).toBeCloseTo(16 / 9, 1)
  expect(infoBounds.y).toBeGreaterThanOrEqual(playerBounds.y + playerBounds.height)
})

test('an error from the outgoing player is ignored while the view reloads', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [{ error: true }], { isLoading: true, legacyFormats: [] })

  expect(result.reloads).toHaveLength(0)
  expect(result.finalFormat).toBe('dash')
  expect(result.errorMessage).toBe('')
})

test('a SABR reload request from the outgoing player is ignored', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [{ reloadRequest: true }], { isLoading: true, legacyFormats: [] })

  expect(result.reloads).toHaveLength(0)
  expect(result.finalFormat).toBe('dash')
  expect(result.errorMessage).toBe('')
})

test('a rejected SABR reload request reports terminal recovery', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  const result = await driveWatchView(page, [{ reloadRequest: true }], {
    legacyFormats: [],
    rejectReload: true
  })

  expect(result.reloads).toEqual(['Reloading player according to SABR request'])
  expect(result.finalFormat).toBe('dash')
  expect(result.errorMessage).toContain('Unable to recover the video stream')
})

test('seeking around a stream that never plays does not refill the budget', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  // Each failure is followed by a long seek rather than real playback, so the
  // budget must still run out instead of being topped up by the position jump.
  const result = await driveWatchView(page, [
    { error: true },
    { seekTo: 300 },
    { error: true },
    { seekTo: 900 },
    { error: true },
    { seekTo: 60 },
    { error: true }
  ])

  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES)
  expect(result.finalFormat).toBe('legacy')
})

test('a video that keeps breaking after settling still stops reloading eventually', async ({ app, page }) => {
  await mockUnplayableWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  // Every failure is followed by enough real playback to refill the per-incident
  // budget, so without a hard per-video ceiling this reloads for ever. That is
  // what turned an unrecoverable stream into an unwatchable reload loop rather
  // than letting it settle on a format that plays.
  const script = []
  for (let i = 0; i < 12; i++) {
    script.push({ error: true }, { playFor: 60 })
  }

  const result = await driveWatchView(page, script)

  // Exactly the documented per-video ceiling: every failure up to it recovers,
  // and the ones after it fall back instead of reloading again.
  expect(result.reloads).toHaveLength(MAX_SABR_ERROR_RECOVERIES_PER_VIDEO)
  expect(result.finalFormat).toBe('legacy')
})
