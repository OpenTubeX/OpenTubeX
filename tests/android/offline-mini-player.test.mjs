import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'
import { blockAppNetwork, connectAndroidApp } from '../helpers/android-webview.mjs'

// Run against a current debug APK on a locked emulator, with its WebView
// socket forwarded to ANDROID_CDP_URL. ANDROID_OFFLINE_MEDIA_PATH must select
// an MP3 accessible to the app so the real downloaded-file loader is exercised.
test('downloaded audio stays pinned on scroll and docks on navigation and swipe without an online countdown', {
  skip: !process.env.ANDROID_CDP_URL,
}, async t => {
  assert.ok(process.env.ANDROID_OFFLINE_MEDIA_PATH, 'Set ANDROID_OFFLINE_MEDIA_PATH to an app-local MP3')
  const { browser, page } = await connectAndroidApp()
  const context = browser.contexts()[0]
  const session = await context.newCDPSession(page)
  let settings
  let watch
  let downloadId
  const originalRoute = await page.evaluate(() => location.hash)
  try {
    await page.locator('.profileTrigger').waitFor()
    await page.evaluate(() => {
      const findTutorial = vnode => {
        const component = vnode?.component
        if (component?.type?.__name === 'FtTutorialOverlay') return component
        if (component?.subTree) {
          const match = findTutorial(component.subTree)
          if (match) return match
        }
        for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
          const match = findTutorial(child)
          if (match) return match
        }
      }
      // Close the tour through its normal parent handler, including an
      // interrupted tour targeting a Watch element that is no longer visible.
      findTutorial(document.querySelector('#app').__vue_app__._container._vnode)?.proxy.$emit('close')
    })
    await expect(page.locator('#cross-tab-mini-player-layer')).not.toHaveAttribute('inert')
    await blockAppNetwork(page)
    settings = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        VideoPlaybackEngine: 'built-in',
        AutoplayVideos: false,
        UseSponsorBlock: false,
        UseReturnYouTubeDislikes: false,
        KeepPlayingOnNavigation: true,
        CapacitorLayoutMode: 'phone',
        UiScale: 100,
        ReducedMotion: 'off',
        AnimationSpeed: 100,
        EnableMobileFullscreenSwipe: false,
        RotateFullscreenToLandscape: false,
        EnterFullscreenOnDisplayRotate: false,
        MobileLeftSwipeAction: 'disabled',
        MobileRightSwipeAction: 'disabled',
        CompactMobileMiniPlayer: false,
        // A slow load would otherwise fall back to yt-dlp, which replaces the download.
        PlaybackEngineFallback: false,
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      store.dispatch('updateReducedMotion', 'off')
      location.hash = '#/watch/jNQXAC9IVRw'
      return saved
    })
    await expect.poll(async () => {
      const handle = await page.evaluateHandle(findWatchComponent)
      try {
        return await handle.evaluate(component => !!component && component.proxy.onMountedRun && !component.proxy.isLoading &&
          component.proxy.preparingVideoLoadGeneration === null && component.proxy.isCurrentlyPresented())
      } finally { await handle.dispose() }
    }, { timeout: 60_000 }).toBe(true)
    watch = await page.evaluateHandle(findWatchComponent)
    const thumbnail = (await readFile(new URL('../../e2e/fixtures/media/video-thumbnail.svg', import.meta.url))).toString('base64')
    downloadId = await page.evaluate(() => {
      const downloads = document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getYtDlpDownloads
      let id = Date.now()
      while (Object.hasOwn(downloads, id)) id++
      return id
    })
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    // The test blocks the Watch page's own requests, and under load the page
    // can report that failure after the download replaced its video. Apply
    // the download again until it plays.
    await expect(async () => {
      await watch.evaluate((component, { thumbnail, mediaPath, downloadId }) => {
        const watch = component.proxy
        watch.videoLoadGeneration++
        Object.assign(watch, {
          isLoading: false,
          ytDlpStreamsPending: false,
          errorMessage: null,
          isUpcoming: false,
          isLive: false,
          videoTitle: 'Downloaded audio mini-player regression',
          channelName: 'Offline test channel',
          videoLengthSeconds: 60,
          thumbnail: `data:image/svg+xml;base64,${thumbnail}`,
          // Online metadata can still carry a future preroll deadline for a download.
          adEndTimeUnixMs: Date.now() + 60000,
        })
        watch.$store.commit('upsertYtDlpDownload', {
          id: downloadId,
          videoId: watch.videoId,
          title: watch.videoTitle,
          mode: 'audio',
          status: 'completed',
          files: [{ videoId: watch.videoId, path: mediaPath, extension: 'mp3' }],
        })
        watch.applyDownloadedPlaybackSource(downloadId)
      }, { thumbnail, mediaPath: process.env.ANDROID_OFFLINE_MEDIA_PATH, downloadId })
      await expect(player).toBeVisible()
      await expect.poll(() => video.evaluate(element => element.readyState), { timeout: 15000 }).toBe(4)
    }).toPass({ timeout: 120_000 })
    await expect(player.locator('.countdownOverlay')).toHaveCount(0)
    await video.evaluate(element => { element.loop = true; return element.play() })
    const originalVideo = await video.elementHandle()
    const settle = async () => {
      await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
      await expect.poll(() => player.evaluate(element => element.getAnimations().every(animation => animation.playState !== 'running'))).toBe(true)
    }
    const assertPlaying = async () => {
      assert.equal(await originalVideo.evaluate(element => element === document.querySelector('.ftVideoPlayer video') && !element.paused), true)
    }
    const touch = (type, point) => session.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] })
    for (const scale of [100, 125]) {
      await page.evaluate(scale => {
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', scale)
        const spacer = document.createElement('div')
        spacer.id = 'offline-mini-test-spacer'
        spacer.style.height = '2000px'
        // The player stays pinned while its Watch page is in view, so lengthen
        // the page itself rather than whatever follows it.
        document.querySelector('.videoLayout').append(spacer)
        window.scrollTo(0, 0)
      }, scale)
      // Portrait phones have room to pin the player, so scrolling keeps it inline.
      await t.test(`scroll keeps downloaded audio pinned at ${scale}%`, async () => {
        await page.evaluate(() => window.scrollTo(0, 1200))
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
        await settle()
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
        const bounds = await player.boundingBox()
        assert.ok(bounds.y >= 0 && bounds.height > 0, 'the pinned player stays in view')
        await assertPlaying()
        await page.evaluate(() => window.scrollTo(0, 0))
        await settle()
      })
      await t.test(`navigation retains downloaded audio with a visible bar at ${scale}%`, async () => {
        await page.evaluate(() => { location.hash = '#/subscriptions' })
        await expect(player).toHaveClass(/mobileMiniBar/)
        await settle()
        await expect(player.locator('.mobileMiniBarTitle')).toHaveText('Downloaded audio mini-player regression')
        await expect(player.locator('.countdownPoster img')).toBeVisible()
        await assertPlaying()
        await player.locator('.mobileMiniBarReturn').click()
        await expect(page).toHaveURL(/#\/watch\//)
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
        await settle()
      })
      await t.test(`swiping downloaded audio minimizes and restores at ${scale}%`, async () => {
        const bounds = await player.boundingBox()
        const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        await touch('touchStart', start)
        for (const distance of [30, 60, 100, 160]) await touch('touchMove', { ...start, y: start.y + distance })
        await touch('touchEnd')
        await expect(player).toHaveClass(/mobileMiniBar/)
        await expect(page).toHaveURL(/#\/subscriptions/)
        await settle()
        await assertPlaying()
        await player.locator('.mobileMiniBarReturn').click()
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
        await settle()
      })
      await page.evaluate(() => document.querySelector('#offline-mini-test-spacer')?.remove())
    }
    if (process.env.ANDROID_EVIDENCE_PATH) {
      await page.evaluate(() => {
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', 100)
        location.hash = '#/subscriptions'
      })
      await expect.poll(() => page.evaluate(() => window.visualViewport.scale)).toBe(1)
      await expect(player).toHaveClass(/mobileMiniBar/)
      await settle()
      await page.screenshot({ path: process.env.ANDROID_EVIDENCE_PATH })
    }
    await originalVideo.dispose()
  } finally {
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => {})
    await page.evaluate(async ({ settings, originalRoute, downloadId }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      document.querySelector('.ftVideoPlayer video')?.pause()
      store.commit('setKeepPlayingOnNavigation', false)
      if (downloadId !== undefined) store.commit('removeYtDlpDownload', downloadId)
      location.hash = originalRoute
      for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
      window.__androidTestNetwork?.restore()
      document.querySelector('#offline-mini-test-spacer')?.remove()
      // Wait for the saved setting, as the next script restarts the app.
      if (settings) await store.dispatch('updateReducedMotion', settings.ReducedMotion)
    }, { settings, originalRoute, downloadId })
    await watch?.dispose()
    await session.detach()
    await browser.close()
  }
})
