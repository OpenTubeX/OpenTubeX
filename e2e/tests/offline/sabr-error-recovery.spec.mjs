import { goTo, test, expect } from '../../helpers/app.mjs'
import { mockUnplayableWatchPage, watchHistoryEntry } from '../../helpers/watch.mjs'

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
 * @param {{ isLoading?: boolean, legacyFormats?: Array<object>, rejectReload?: boolean }} options
 */
function driveWatchView(page, script, options = {}) {
  return page.evaluate(async ({ steps, isLoading, legacyFormats, rejectReload }) => {
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

    return { reloads, formats, finalFormat: watchView.activeFormat, errorMessage: watchView.errorMessage }
  }, {
    steps: script,
    isLoading: options.isLoading ?? false,
    legacyFormats: options.legacyFormats ?? [{ itag: 18, qualityLabel: '360p', height: 360, width: 640, url: 'https://example.invalid/360p' }],
    rejectReload: options.rejectReload ?? false
  })
}

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
