import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Run against a current debug APK on a locked emulator, forwarding its WebView
// socket and setting ANDROID_CDP_URL=http://127.0.0.1:<forwarded-port>.
// Set ANDROID_SERIAL too to cover Android native long presses and context menus.
test('touch holds double playback speed and restore it on release', {
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
        VideoPlaybackEngine: 'built-in',
        AutoplayVideos: false,
        UseSponsorBlock: false,
        UseReturnYouTubeDislikes: false,
        EnableMobileFullscreenSwipe: true,
        RotateFullscreenToLandscape: false,
        EnterFullscreenOnDisplayRotate: false,
        PlayingInterfaceHideDelay: 5,
        HoldToDoublePlaybackSpeed: true,
        MobileLeftSwipeAction: 'disabled',
        MobileRightSwipeAction: 'disabled',
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.__playbackSpeedHoldFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__playbackSpeedHoldFetch(url, options)
        : Promise.reject(new Error('Offline playback speed hold test'))
      const style = document.createElement('style')
      style.id = 'playback-speed-hold-test-style'
      style.textContent = '.tutorialOverlay { display: none !important; }'
      document.head.append(style)
      location.hash = '#/watch/jNQXAC9IVRw'
      return saved
    })
    await expect.poll(async () => {
      const handle = await page.evaluateHandle(findWatchComponent)
      try { return await handle.evaluate(component => !!component && component.proxy.preparingVideoLoadGeneration === null) } finally { await handle.dispose() }
    }).toBe(true)
    watch = await page.evaluateHandle(findWatchComponent)
    const media = (await readFile(new URL('../../e2e/fixtures/media/demo.webm', import.meta.url))).toString('base64')
    await watch.evaluate((component, media) => {
      const watch = component.proxy
      watch.videoLoadGeneration++
      Object.assign(watch, {
        isLoading: false,
        ytDlpStreamsPending: false,
        errorMessage: null,
        isUpcoming: false,
        isLive: false,
        localFilePlayback: true,
        activeFormat: 'legacy',
        videoTitle: 'Playback speed hold test',
        videoLengthSeconds: 60,
        legacyFormats: [{
          itag: 0,
          qualityLabel: 'Test',
          mimeType: 'video/webm',
          width: 320,
          height: 180,
          bitrate: 0,
          localFile: true,
          url: `data:video/webm;base64,${media}`
        }],
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
    const playButton = player.locator('.shaka-big-buttons-container .shaka-play-button')
    for (const fullscreen of [false, true]) {
      if (fullscreen) {
        await controls.evaluate(element => element.setAttribute('shown', 'true'))
        await player.locator('.shaka-fullscreen-button').click()
        await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
      }
      for (const native of process.env.ANDROID_SERIAL ? [false, true] : [false]) {
        await video.evaluate(video => { video.playbackRate = 1.25 })
        await controls.evaluate(element => element.removeAttribute('shown'))
        await expect(playButton).toHaveCSS('opacity', '0')
        const bounds = await playButton.boundingBox()
        const x = bounds.x + bounds.width / 2
        const y = bounds.y + bounds.height / 2
        let finished
        if (native) {
          const adb = (...args) => promisify(execFile)('adb', ['-s', process.env.ANDROID_SERIAL, ...args])
          const dumpPath = '/sdcard/otx-hold-window.xml'
          await adb('shell', 'uiautomator', 'dump', dumpPath)
          const { stdout } = await adb('exec-out', 'cat', dumpPath)
          await adb('shell', 'rm', dumpPath)
          const webView = stdout.match(/class="android.webkit.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
          assert.ok(webView, 'The WebView must have native screen bounds')
          const point = await page.evaluate(({ x, y }) => {
            const scale = devicePixelRatio * visualViewport.scale
            return { x: Math.round(x * scale), y: Math.round(y * scale) }
          }, { x, y })
          const screenX = String(Number(webView[1]) + point.x)
          const screenY = String(Number(webView[2]) + point.y)
          finished = adb('shell', 'input', 'swipe', screenX, screenY, screenX, screenY, '2500')
        } else {
          await touch('touchStart', x, y)
        }
        try {
          await expect.poll(() => video.evaluate(video => video.playbackRate), { timeout: 2000 }).toBe(2.5)
        } finally {
          if (native) await finished
          else await touch('touchEnd')
        }
        await expect.poll(() => video.evaluate(video => video.playbackRate)).toBe(1.25)
        assert.equal(await video.evaluate(video => video.paused), false, 'Releasing a hold must keep playback running')
        await expect(controls).not.toHaveAttribute('shown', { timeout: 1000 })
        await page.waitForTimeout(400)
      }
      const bounds = await playButton.boundingBox()
      await touch('touchStart', bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await touch('touchEnd')
      await expect(controls).toHaveAttribute('shown', 'true')
      await playButton.click()
      await expect.poll(() => video.evaluate(video => video.paused)).toBe(true)
      await playButton.click()
      await expect.poll(() => video.evaluate(video => video.paused)).toBe(false)
    }
  } finally {
    await page.evaluate(async ({ settings, originalRoute }) => {
      if (document.fullscreenElement) await document.exitFullscreen()
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
      if (window.__playbackSpeedHoldFetch) window.fetch = window.__playbackSpeedHoldFetch
      delete window.__playbackSpeedHoldFetch
      document.querySelector('#playback-speed-hold-test-style')?.remove()
      location.hash = originalRoute
    }, { settings, originalRoute })
    await watch?.dispose()
    await session.detach()
    await browser.close()
  }
})
