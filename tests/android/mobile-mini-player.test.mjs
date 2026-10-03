import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent, mobileMiniPlayerRegions, mobileMiniPlayerReturnPoint } from '../../e2e/helpers/player.mjs'

// Run against a current debug APK on a locked emulator, forwarding its WebView
// socket and setting ANDROID_CDP_URL=http://127.0.0.1:<forwarded-port>.
test('mobile mini-player restores from the whole bar and keeps close separate', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  const session = await context.newCDPSession(page)
  let settings
  let watch
  const originalRoute = await page.evaluate(() => location.hash)
  try {
    await page.locator('.profileTrigger').waitFor()
    settings = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        VideoPlaybackEngine: 'built-in', AutoplayVideos: false,
        UseSponsorBlock: false, UseReturnYouTubeDislikes: false,
        KeepPlayingOnNavigation: true, ScrollMiniPlayerEnabled: true, CapacitorLayoutMode: 'phone',
        UiScale: 100, ReducedMotion: 'off', EnableMobileFullscreenSwipe: false, RotateFullscreenToLandscape: false,
        EnterFullscreenOnDisplayRotate: false, PlayingInterfaceHideDelay: 5,
        MobileLeftSwipeAction: 'disabled', MobileRightSwipeAction: 'disabled',
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      store.dispatch('updateReducedMotion', 'off')
      window.__miniPlayerFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__miniPlayerFetch(url, options) : Promise.reject(new Error('Offline mini-player test'))
      const style = document.createElement('style')
      style.id = 'mini-player-test-style'
      style.textContent = '.tutorialOverlay { display: none !important; }'
      document.head.append(style)
      location.hash = '#/watch/jNQXAC9IVRw'
      return saved
    })
    await expect.poll(async () => {
      const handle = await page.evaluateHandle(findWatchComponent)
      try { return await handle.evaluate(component => !!component && component.proxy.preparingVideoLoadGeneration === null) }
      finally { await handle.dispose() }
    }).toBe(true)
    watch = await page.evaluateHandle(findWatchComponent)
    const media = (await readFile(new URL('../../e2e/fixtures/media/demo.webm', import.meta.url))).toString('base64')
    await watch.evaluate((component, media) => {
      const watch = component.proxy
      watch.videoLoadGeneration++
      Object.assign(watch, {
        isLoading: false, ytDlpStreamsPending: false, errorMessage: null,
        isUpcoming: false, isLive: false, localFilePlayback: true, activeFormat: 'legacy',
        videoTitle: 'A long mini-player title with more room after removing the expand arrow', videoLengthSeconds: 60,
        legacyFormats: [{ itag: 0, qualityLabel: 'Test', mimeType: 'video/webm',
          width: 320, height: 180, bitrate: 0, localFile: true, url: `data:video/webm;base64,${media}` }],
      })
    }, media)
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    await expect.poll(() => video.evaluate(video => video.readyState), { timeout: 15000 }).toBe(4)
    await watch.evaluate(component => { component.proxy.channelName = 'Mini-player test channel' })
    await video.evaluate(video => { video.loop = true; return video.play() })
    const originalVideo = await video.elementHandle()
    const touch = (type, point) => session.send('Input.dispatchTouchEvent', {
      type, touchPoints: point ? [point] : [],
    })
    for (const scale of [100, 125]) {
      await page.evaluate(scale => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setUiScale', scale)
        store.dispatch('updateReducedMotion', scale === 125 ? 'on' : 'off')
      }, scale)
      await page.evaluate(() => {
        const spacer = document.createElement('div')
        spacer.id = 'mini-player-test-spacer'
        spacer.style.height = '2000px'
        document.body.append(spacer)
      })
      for (const region of mobileMiniPlayerRegions) {
        await page.evaluate(() => window.scrollTo(0, 1200))
        await expect(player).toHaveClass(/mobileMiniBar/)
        await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
        const point = await player.evaluate(mobileMiniPlayerReturnPoint, region)
        await touch('touchStart', point)
        for (const distance of [20, 40, 80, 100]) await touch('touchMove', { ...point, y: point.y - distance })
        await touch('touchEnd')
        await expect(player, `same-page swipe on ${region} at ${scale}%`).not.toHaveClass(/scrollMiniPlayer/)
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
        await page.waitForTimeout(400)
        await expect(page).toHaveURL(/#\/watch\//)
      }
      await page.evaluate(() => document.querySelector('#mini-player-test-spacer')?.remove())
      for (const swipe of [false, true]) {
        for (const region of mobileMiniPlayerRegions) {
          // Navigate away while playback continues, retaining the actual player.
          await page.evaluate(() => { location.hash = '#/subscriptions' })
          await expect(player).toHaveClass(/mobileMiniBar/)
          await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
          const returnButton = player.locator('.mobileMiniBarReturn')
          await expect(returnButton).toBeEnabled()
          await expect(returnButton.locator('svg')).toHaveCount(0)
          const point = await player.evaluate(mobileMiniPlayerReturnPoint, region)
          await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('mobileMiniBarReturn'), point), { message: region }).toBe(true)
          await touch('touchStart', point)
          if (swipe) {
            for (const distance of [20, 40, 80, 100]) await touch('touchMove', { ...point, y: point.y - distance })
          }
          await touch('touchEnd')
          await expect(page, `${swipe ? 'swipe' : 'tap'} on ${region} at ${scale}%`).toHaveURL(/#\/watch\//)
          await expect(player).not.toHaveClass(/scrollMiniPlayer/)
          await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
          assert.equal(await originalVideo.evaluate(video => video === document.querySelector('.ftVideoPlayer video') && !video.paused), true)
          await page.waitForTimeout(400)
          await expect(page, 'Compatibility clicks must not activate the restored page').toHaveURL(/#\/watch\//)
        }
      }
    }
    await page.evaluate(() => { location.hash = '#/subscriptions' })
    const close = player.locator('.mobileMiniBarDismiss')
    await expect(close).toBeEnabled()
    const box = await close.boundingBox()
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    assert.equal(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.mobileMiniBarDismiss')), point), true)
    // A swipe beginning on close must never restore the Watch view.
    await touch('touchStart', point)
    for (const distance of [20, 40, 80, 100]) await touch('touchMove', { ...point, y: point.y - distance })
    await touch('touchCancel')
    await expect(page).toHaveURL(/#\/subscriptions/)
    await expect(close).toBeEnabled()
    await touch('touchStart', point)
    await touch('touchEnd')
    await expect(page.locator('.mobileMiniBarOverlay')).toHaveCount(0)
    await expect(page).toHaveURL(/#\/subscriptions/)
    await originalVideo.dispose()
  } finally {
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => {})
    await page.evaluate(({ settings, originalRoute }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      document.querySelector('.ftVideoPlayer video')?.pause()
      store.commit('setKeepPlayingOnNavigation', false)
      location.hash = originalRoute
      for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
      if (settings) store.dispatch('updateReducedMotion', settings.ReducedMotion)
      if (window.__miniPlayerFetch) window.fetch = window.__miniPlayerFetch
      delete window.__miniPlayerFetch
      document.querySelector('#mini-player-test-style')?.remove()
      document.querySelector('#mini-player-test-spacer')?.remove()
    }, { settings, originalRoute })
    await watch?.dispose()
    await session.detach()
    await browser.close()
  }
})
