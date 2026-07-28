import crypto from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import { goTo, repoRoot, test, expect } from '../../helpers/app.mjs'
import { fixtureKey } from '../../helpers/innertube.mjs'

const fixtureDir = path.join(repoRoot, 'e2e', 'fixtures', 'innertube', 'watch', 'shows-video-metadata')
const sharedDir = path.join(repoRoot, 'e2e', 'fixtures', 'innertube', 'shared')

// Mirrors MAX_SABR_ERROR_RECOVERIES_PER_VIDEO in src/renderer/views/Watch/Watch.js,
// which is a module-level constant in a Vue component and so cannot be imported here.
const MAX_SABR_ERROR_RECOVERIES_PER_VIDEO = 8

test.use({
  seed: {
    history: [{
      _id: 'jNQXAC9IVRw',
      videoId: 'jNQXAC9IVRw',
      title: 'SABR test video',
      author: 'Test Channel',
      authorId: 'UC-test-channel-id',
      published: Date.now() - 86_400_000,
      description: '',
      viewCount: 1234,
      lengthSeconds: 600,
      watchProgress: 10,
      isWatched: false,
      timeWatched: Date.now(),
      isLive: false,
      type: 'video'
    }]
  }
})

async function fixture(dir, name) {
  try {
    return gunzipSync(await readFile(path.join(dir, name)))
  } catch {
    return null
  }
}

/**
 * Serves the watch page from fixtures with an unplayable video, so the Watch
 * view mounts without a real player emitting errors of its own.
 */
async function mockWatchPage(app, page) {
  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('generate-po-token')
    ipcMain.handle('generate-po-token', () => 'test-po-token')
  })

  await page.route(/^https?:\/\//, (route) => route.abort())
  await page.route(/^https?:\/\//, async (route, request) => {
    const url = request.url()

    if (url.includes('/img/desktop/unavailable/')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: '' })
    }

    if (/\/s\/player\//.test(url) || /\/sw\.js_data/.test(url)) {
      const { pathname } = new URL(url)
      const name = `shared-${crypto.createHash('sha1').update(pathname).digest('hex').slice(0, 12)}.gz`
      const body = await fixture(sharedDir, name) ??
        (url.includes('/s/player/') ? await fixture(sharedDir, 'shared-99c4a5c04897.gz') : null)
      if (body) {
        return route.fulfill({
          status: 200,
          contentType: url.includes('/s/player/') ? 'text/javascript' : 'application/json',
          body
        })
      }
      return route.abort()
    }

    if (url.includes('/youtubei/v1/player')) {
      const files = await readdir(fixtureDir)
      const body = await fixture(fixtureDir, files.find((file) => file.startsWith('player-')))
      const json = JSON.parse(body.toString())
      json.playabilityStatus = { status: 'UNPLAYABLE', reason: 'Video unavailable' }
      delete json.streamingData
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
    }

    if (url.includes('/youtubei/v1/')) {
      const key = fixtureKey(url, request.postData())
      let body = await fixture(fixtureDir, `${key}.0.json.gz`)
      if (!body) {
        const endpoint = key.replace(/-[0-9a-f]{12}$/, '')
        const files = (await readdir(fixtureDir)).filter((file) => file.startsWith(`${endpoint}-`))
        if (files.length > 0) body = await fixture(fixtureDir, files[0])
      }
      if (body) {
        return route.fulfill({ status: 200, contentType: 'application/json', body })
      }
      return route.abort()
    }

    return route.fallback()
  })
}

/**
 * Puts the mounted Watch view into "playing a SABR stream on DASH" state, then
 * replays a scripted sequence of critical player errors and playback progress
 * against it. Reload requests are recorded instead of performed, so the run
 * stays offline and deterministic.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<{ error: true } | { playFor: number } | { seekTo: number }>} script
 */
function driveWatchView(page, script) {
  return page.evaluate(async (steps) => {
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
    watchView.isLoading = false
    watchView.isLive = false
    watchView.isPostLiveDvr = false
    watchView.activeFormat = 'dash'
    watchView.manifestMimeType = 'application/sabr+json'
    watchView.manifestSrc = 'sabr://test'
    watchView.legacyFormats = [{ itag: 18, qualityLabel: '360p', height: 360, width: 640, url: 'https://example.invalid/360p' }]

    const reloads = []
    watchView.onPlayerReloadRequested = async (_payload, toastMessage) => {
      reloads.push(toastMessage)
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

    return { reloads, formats, finalFormat: watchView.activeFormat }
  }, script)
}

test('a second SABR failure after successful playback refetches instead of dropping to legacy', async ({ app, page }) => {
  await mockWatchPage(app, page)
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

test('SABR failures that never settle stop refetching and fall back to legacy', async ({ app, page }) => {
  await mockWatchPage(app, page)
  await goTo(page, 'history')
  await page.getByText('SABR test video').click()
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.errorMessage')).toBeVisible({ timeout: 30_000 })

  // Four back-to-back failures with no playback progress in between.
  const result = await driveWatchView(page, [
    { error: true },
    { error: true },
    { error: true },
    { error: true }
  ])

  expect(result.reloads).toHaveLength(3)
  expect(result.formats).toEqual(['dash', 'dash', 'dash', 'legacy'])
})

test('seeking around a stream that never plays does not refill the budget', async ({ app, page }) => {
  await mockWatchPage(app, page)
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

  expect(result.reloads).toHaveLength(3)
  expect(result.finalFormat).toBe('legacy')
})

test('a video that keeps breaking after settling still stops reloading eventually', async ({ app, page }) => {
  await mockWatchPage(app, page)
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
