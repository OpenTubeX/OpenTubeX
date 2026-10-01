import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Run against a current debug APK on a locked emulator, forwarding its WebView
// socket and setting ANDROID_CDP_URL=http://127.0.0.1:<forwarded-port>.
test('fullscreen swipe controls respect the idle delay and subsequent surface taps', {
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
        EnableMobileFullscreenSwipe: true, RotateFullscreenToLandscape: false,
        EnterFullscreenOnDisplayRotate: false, PlayingInterfaceHideDelay: 5,
        MobileLeftSwipeAction: 'disabled', MobileRightSwipeAction: 'disabled',
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.__fullscreenControlsFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__fullscreenControlsFetch(url, options) : Promise.reject(new Error('Offline fullscreen test'))
      const style = document.createElement('style')
      style.id = 'fullscreen-controls-test-style'
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
        videoTitle: 'Fullscreen controls test', videoLengthSeconds: 60,
        legacyFormats: [{ itag: 0, qualityLabel: 'Test', mimeType: 'video/webm',
          width: 320, height: 180, bitrate: 0, localFile: true, url: `data:video/webm;base64,${media}` }],
      })
    }, media)
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    const controls = player.locator('.shaka-controls-container')
    await expect.poll(() => video.evaluate(video => ({ ready: video.readyState, source: video.currentSrc.slice(0, 80), error: video.error?.message })), { timeout: 15000 }).toMatchObject({ ready: 4 })
    await video.evaluate(video => { video.loop = true; return video.play() })
    await expect.poll(() => video.evaluate(video => video.paused)).toBe(false)
    await expect(controls).not.toHaveAttribute('shown', { timeout: 10000 })

    const touch = (type, x, y) => session.send('Input.dispatchTouchEvent', {
      type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    })
    const swipe = async direction => {
      const bounds = await player.boundingBox()
      const x = bounds.x + bounds.width / 2
      const start = bounds.y + bounds.height * (direction < 0 ? 0.4 : 0.25)
      const distance = Math.min(100, bounds.height * 0.5) * direction
      await touch('touchStart', x, start)
      for (let step = 1; step <= 6; step++) {
        await touch('touchMove', x, start + distance * step / 6)
      }
      await touch('touchEnd')
    }
    await swipe(-1)
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null), { timeout: 15000 }).toBe(true)
    assert.equal(await player.getAttribute('data-playing-interface-hide-delay'), '5')
    await expect(controls).toHaveAttribute('shown', 'true')
    // The inline default is three seconds. Staying visible past that default
    // distinguishes the fullscreen preference from merely restarting a timer.
    await page.waitForTimeout(4000)
    await expect(controls).toHaveAttribute('shown', 'true')
    await expect(controls).not.toHaveAttribute('shown', { timeout: 6000 })
    await expect(controls.locator('.shaka-controls-button-panel')).toBeHidden()
    await expect(controls.locator('.shaka-seek-bar-container')).toHaveCSS('opacity', '0')

    // A fresh tap must reveal controls once and still allow them to hide.
    const bounds = await player.boundingBox()
    await touch('touchStart', bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.35)
    await touch('touchEnd')
    await expect(controls).toHaveAttribute('shown', 'true')
    await touch('touchStart', bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.35)
    await touch('touchEnd')
    await expect(controls).not.toHaveAttribute('shown', { timeout: 1000 })
    await touch('touchStart', bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.35)
    await touch('touchEnd')
    await expect(controls).toHaveAttribute('shown', 'true')
    await expect(controls).not.toHaveAttribute('shown', { timeout: 6000 })
    await swipe(1)
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
    assert.equal(await video.evaluate(video => video.paused), false, 'Swipes must not toggle playback')
  } finally {
    await page.evaluate(async ({ settings, originalRoute }) => {
      if (document.fullscreenElement) await document.exitFullscreen()
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
      if (window.__fullscreenControlsFetch) window.fetch = window.__fullscreenControlsFetch
      delete window.__fullscreenControlsFetch
      document.querySelector('#fullscreen-controls-test-style')?.remove()
      location.hash = originalRoute
    }, { settings, originalRoute })
    await watch?.dispose()
    await session.detach()
    await browser.close()
  }
})
