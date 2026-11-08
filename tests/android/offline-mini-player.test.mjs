import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Run against a current debug APK on a locked emulator, with its WebView
// socket forwarded to ANDROID_CDP_URL. ANDROID_OFFLINE_MEDIA_PATH must select
// an MP3 accessible to the app so the real downloaded-file loader is exercised.
test('downloaded audio docks on scroll, navigation and swipe without an online countdown', {
  skip: !process.env.ANDROID_CDP_URL,
}, async t => {
  assert.ok(process.env.ANDROID_OFFLINE_MEDIA_PATH, 'Set ANDROID_OFFLINE_MEDIA_PATH to an app-local MP3')
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const context = browser.contexts()[0]
  const page = context.pages()[0]
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
    settings = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        VideoPlaybackEngine: 'built-in', AutoplayVideos: false,
        UseSponsorBlock: false, UseReturnYouTubeDislikes: false,
        KeepPlayingOnNavigation: true, ScrollMiniPlayerEnabled: true, CapacitorLayoutMode: 'phone',
        UiScale: 100, ReducedMotion: 'off', AnimationSpeed: 100,
        EnableMobileFullscreenSwipe: false, RotateFullscreenToLandscape: false,
        EnterFullscreenOnDisplayRotate: false,
        MobileLeftSwipeAction: 'disabled', MobileRightSwipeAction: 'disabled',
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      store.dispatch('updateReducedMotion', 'off')
      window.__offlineMiniFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__offlineMiniFetch(url, options) : Promise.reject(new Error('Offline mini-player test'))
      location.hash = '#/watch/jNQXAC9IVRw'
      return saved
    })
    await expect.poll(async () => {
      const handle = await page.evaluateHandle(findWatchComponent)
      try {
        return await handle.evaluate(component => !!component && component.proxy.onMountedRun &&
          component.proxy.preparingVideoLoadGeneration === null && component.proxy.isCurrentlyPresented())
      } finally { await handle.dispose() }
    }).toBe(true)
    watch = await page.evaluateHandle(findWatchComponent)
    const thumbnail = (await readFile(new URL('../../e2e/fixtures/media/video-thumbnail.svg', import.meta.url))).toString('base64')
    downloadId = await page.evaluate(() => {
      const downloads = document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getYtDlpDownloads
      let id = Date.now()
      while (Object.hasOwn(downloads, id)) id++
      return id
    })
    await watch.evaluate((component, { thumbnail, mediaPath, downloadId }) => {
      const watch = component.proxy
      watch.videoLoadGeneration++
      Object.assign(watch, {
        isLoading: false, ytDlpStreamsPending: false, errorMessage: null,
        isUpcoming: false, isLive: false,
        videoTitle: 'Downloaded audio mini-player regression', channelName: 'Offline test channel', videoLengthSeconds: 60,
        thumbnail: `data:image/svg+xml;base64,${thumbnail}`,
        // Online metadata can still carry a future preroll deadline for a download.
        adEndTimeUnixMs: Date.now() + 60000,
      })
      watch.$store.commit('upsertYtDlpDownload', {
        id: downloadId, videoId: watch.videoId, title: watch.videoTitle, mode: 'audio', status: 'completed',
        files: [{ videoId: watch.videoId, path: mediaPath, extension: 'mp3' }],
      })
      watch.applyDownloadedPlaybackSource(downloadId)
    }, { thumbnail, mediaPath: process.env.ANDROID_OFFLINE_MEDIA_PATH, downloadId })
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    await expect(player).toBeVisible()
    await expect.poll(() => video.evaluate(element => element.readyState), { timeout: 15000 }).toBe(4)
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
        document.querySelector('.app > .routerView').append(spacer)
        window.scrollTo(0, 0)
      }, scale)
      await t.test(`scroll docks and restores downloaded audio at ${scale}%`, async () => {
        await page.evaluate(() => window.scrollTo(0, 1200))
        await expect(player).toHaveClass(/mobileMiniBar/)
        await settle()
        await expect(player.locator('.countdownPoster img')).toBeVisible()
        const artwork = await player.locator('.countdownPoster').boundingBox()
        assert.ok(artwork.width > 0 && artwork.height > 0)
        await assertPlaying()
        await page.evaluate(() => window.scrollTo(0, 0))
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
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
    await page.evaluate(({ settings, originalRoute, downloadId }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      document.querySelector('.ftVideoPlayer video')?.pause()
      store.commit('setKeepPlayingOnNavigation', false)
      if (downloadId !== undefined) store.commit('removeYtDlpDownload', downloadId)
      location.hash = originalRoute
      for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
      if (settings) store.dispatch('updateReducedMotion', settings.ReducedMotion)
      if (window.__offlineMiniFetch) window.fetch = window.__offlineMiniFetch
      delete window.__offlineMiniFetch
      document.querySelector('#offline-mini-test-spacer')?.remove()
    }, { settings, originalRoute, downloadId })
    await watch?.dispose()
    await session.detach()
    await browser.close()
  }
})
