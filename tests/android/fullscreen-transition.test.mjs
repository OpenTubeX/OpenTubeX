import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Run against a current debug APK on a locked emulator, forwarding its WebView
// socket and setting ANDROID_CDP_URL=http://127.0.0.1:<forwarded-port>.
test('Android fullscreen keeps the video inside the viewport throughout rotation', {
  skip: !process.env.ANDROID_CDP_URL, timeout: 120000,
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
    const skipTour = page.getByRole('button', { name: 'Skip', exact: true })
    if (await skipTour.isVisible()) await skipTour.click()
    settings = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        VideoPlaybackEngine: 'built-in',
        AutoplayVideos: false,
        UseSponsorBlock: false,
        UseReturnYouTubeDislikes: false,
        EnableMobileFullscreenSwipe: true,
        RotateFullscreenToLandscape: true,
        EnterFullscreenOnDisplayRotate: true,
        PlayingInterfaceHideDelay: 5,
        UiScale: 100,
        CapacitorLayoutMode: 'phone',
        MobileLeftSwipeAction: 'disabled',
        MobileRightSwipeAction: 'disabled',
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.__fullscreenTransitionFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__fullscreenTransitionFetch(url, options)
        : Promise.reject(new Error('Offline fullscreen test'))
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
        videoTitle: 'Fullscreen transition test',
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
    assert.equal(await player.evaluate(element => element.ui.getControls().getConfig().forceLandscapeOnFullscreen), false)
    await expect.poll(() => video.evaluate(video => ({ ready: video.readyState, source: video.currentSrc.slice(0, 80), error: video.error?.message })), { timeout: 15000 }).toMatchObject({ ready: 4 })
    // A saved position from seek tests can loop this short fixture mid-assertion.
    await video.evaluate(video => { video.currentTime = 0; video.loop = true; return video.play() })
    await expect.poll(() => video.evaluate(video => video.paused)).toBe(false)
    await expect.poll(() => page.evaluate(() => innerHeight > innerWidth)).toBe(true)
    for (const scale of [100, 125]) {
      await page.emulateMedia({ reducedMotion: scale === 125 ? 'reduce' : 'no-preference' })
      await page.evaluate(scale => {
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', scale)
      }, scale)
      for (const entering of [true, false]) {
        await page.evaluate(() => {
          window.__transitionFrames = []
          window.__transitionFinished = false
          const start = performance.now()
          const sample = () => {
            const video = document.querySelector('.ftVideoPlayer video')
            const rect = video.getBoundingClientRect()
            const fit = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight)
            const width = video.videoWidth * fit
            const height = video.videoHeight * fit
            window.__transitionFrames.push({
              time: performance.now() - start,
              viewport: [innerWidth, innerHeight],
              fullscreen: !!document.fullscreenElement,
              video: [rect.x + (rect.width - width) / 2, rect.y + (rect.height - height) / 2, width, height],
              player: document.querySelector('.ftVideoPlayer').getBoundingClientRect().toJSON()
            })
            if (performance.now() - start < 2000 || window.__transitionFrames.length < 6) requestAnimationFrame(sample)
            else window.__transitionFinished = true
          }
          requestAnimationFrame(sample)
        })
        const result = await session.send('Runtime.evaluate', {
          expression: `document.querySelector('.shaka-controls-container').setAttribute('shown', 'true');
            document.querySelector('.shaka-fullscreen-button').click()`,
          userGesture: true,
          awaitPromise: true,
        })
        assert.equal(result.exceptionDetails, undefined)
        await expect.poll(() => page.evaluate(() => window.__transitionFinished), { timeout: 15000 }).toBe(true)
        const frames = await page.evaluate(() => window.__transitionFrames)
        const clipped = frames.filter(({ video: [x, y, w, h], viewport: [vw, vh], player }) =>
          x < -1 || y < -1 || x + w > vw + 1 || y + h > vh + 1 ||
          x < player.left - 1 || y < player.top - 1 || x + w > player.right + 1 || y + h > player.bottom + 1)
        assert.equal(clipped.length, 0, `Clipped frames at ${scale}% on ${entering ? 'entry' : 'exit'}: ${JSON.stringify(clipped)}`)
        assert.ok(frames.length > 5, 'Sample rendered frames throughout the transition')
        assert.equal(await page.evaluate(() => !!document.fullscreenElement), entering)
        if (entering && scale === 125) {
          // Re-enter before the pending portrait rotation has completed.
          const retry = await session.send('Runtime.evaluate', {
            expression: `window.__fullscreenReentered = false;
              document.addEventListener('fullscreenchange', function reenter() {
                if (document.fullscreenElement) return;
                document.removeEventListener('fullscreenchange', reenter);
                document.querySelector('.shaka-controls-container').setAttribute('shown', 'true');
                document.querySelector('.shaka-fullscreen-button').click();
                window.__fullscreenReentered = true;
              });
              document.exitFullscreen()`,
            userGesture: true,
            awaitPromise: true,
          })
          assert.equal(retry.exceptionDetails, undefined)
          await expect.poll(() => page.evaluate(() => window.__fullscreenReentered && !!document.fullscreenElement)).toBe(true)
          // The old landscape viewport can remain visible while Android queues
          // portrait and landscape rotations. Let re-entry finish before the
          // next independent exit measurement.
          await page.waitForTimeout(2200)
          await expect.poll(() => page.evaluate(() => innerWidth > innerHeight)).toBe(true)
        }
        if (!entering) {
          await expect.poll(() => page.evaluate(() => innerHeight > innerWidth)).toBe(true)
          await expect(player).not.toHaveClass(/fullWindow/)
          assert.equal(await page.locator('.videoLayout').getAttribute('popover'), null)
        }
      }
      await page.evaluate(() => {
        window.__swipeFullscreenFrames = []
        window.__originalRequestFullscreen = Element.prototype.requestFullscreen
        window.__originalExitFullscreen = document.exitFullscreen
        const sample = () => {
          const video = document.querySelector('.ftVideoPlayer video')
          window.__swipeFullscreenFrames.push({
            translate: getComputedStyle(video).translate,
            prepared: video.closest('.ftVideoPlayer').classList.contains('fullWindow'),
            fullscreen: !!document.fullscreenElement,
          })
        }
        Element.prototype.requestFullscreen = function (...args) {
          sample()
          return window.__originalRequestFullscreen.apply(this, args)
        }
        document.exitFullscreen = function (...args) {
          sample()
          return window.__originalExitFullscreen.apply(this, args)
        }
      })
      for (let i = 0; i < 6; i++) {
        const entering = i % 2 === 0
        // Target the presented player, not the old viewport while Android is
        // rotating it (rotation cancels a pointer stream already in progress).
        await expect.poll(() => page.evaluate(() => innerHeight > innerWidth), { timeout: 10000 }).toBe(entering)
        await player.evaluate(element => element.ui.getControls().hideUI())
        const bounds = await player.boundingBox()
        const x = bounds.x + bounds.width / 2
        const y = bounds.y + bounds.height * 0.3
        // Pointer capture keeps the drag on the surface past its edge. Use a
        // deliberate distance, rather than a short scale-dependent fling.
        const distance = 90 * (entering ? -1 : 1)
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        for (let step = 1; step <= 5; step++) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + distance * step / 5 }] })
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect.poll(() => page.evaluate(() => !!document.fullscreenElement), {
          message: `Swipe ${i + 1} at ${scale}%`, timeout: 10000,
        }).toBe(entering)
      }
      const swipeFrames = await page.evaluate(() => {
        Element.prototype.requestFullscreen = window.__originalRequestFullscreen
        document.exitFullscreen = window.__originalExitFullscreen
        delete window.__originalRequestFullscreen
        delete window.__originalExitFullscreen
        return window.__swipeFullscreenFrames
      })
      assert.equal(swipeFrames.length, 6)
      assert.deepEqual(swipeFrames.filter(({ translate }) => translate !== 'none' && translate !== '0px'), [],
        `Fullscreen must not snapshot the displaced swipe preview at ${scale}%`)
      assert.ok(swipeFrames.every(({ prepared, fullscreen }) => prepared === fullscreen),
        `Keep the inline layout intact until native fullscreen at ${scale}%`)
      await expect.poll(() => page.evaluate(() => innerHeight > innerWidth && !document.querySelector(':popover-open')), { timeout: 10000 }).toBe(true)
    }
    // Emulate a system policy that keeps landscape after unlocking (for example,
    // the user physically turned the phone while watching). The native display
    // remains real; only the unlock request is held for this case.
    await session.send('Runtime.evaluate', {
      expression: `document.querySelector('.shaka-fullscreen-button').click()`, userGesture: true,
    })
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement && innerWidth > innerHeight)).toBe(true)
    await page.evaluate(() => {
      window.__originalOrientationPromise = window.Capacitor.nativePromise
      window.Capacitor.nativePromise = function (plugin, method, ...args) {
        if (plugin === 'ScreenOrientation' && method === 'unlock') return Promise.resolve()
        return window.__originalOrientationPromise.call(this, plugin, method, ...args)
      }
    })
    await session.send('Runtime.evaluate', {
      expression: `document.querySelector('.shaka-fullscreen-button').click()`, userGesture: true,
    })
    await expect.poll(() => page.evaluate(() => !document.fullscreenElement && !document.querySelector(':popover-open')), {
      timeout: 1500, message: 'Exit promptly when the native display remains landscape',
    }).toBe(true)
    assert.equal(await page.evaluate(() => innerWidth > innerHeight), true)
    // Start the next session in landscape, then let unlock restore portrait.
    // Entry orientation cannot predict where a locked device will rotate on exit.
    await session.send('Runtime.evaluate', {
      expression: `document.querySelector('.shaka-fullscreen-button').click()`, userGesture: true,
    })
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
    await page.evaluate(() => {
      window.Capacitor.nativePromise = window.__originalOrientationPromise
      delete window.__originalOrientationPromise
      document.addEventListener('fullscreenchange', function exited() {
        if (document.fullscreenElement) return
        document.removeEventListener('fullscreenchange', exited)
        window.__landscapeExitRetained = !!document.querySelector('.videoLayout:popover-open')
      })
    })
    await session.send('Runtime.evaluate', {
      expression: `document.querySelector('.shaka-fullscreen-button').click()`, userGesture: true,
    })
    await expect.poll(() => page.evaluate(() => window.__landscapeExitRetained), {
      message: 'Protect rotation even when fullscreen started in landscape',
    }).toBe(true)
    await expect.poll(() => page.evaluate(() => innerHeight > innerWidth && !document.querySelector(':popover-open')), {
      timeout: 10000,
    }).toBe(true)
  } finally {
    await page.evaluate(async ({ settings, originalRoute }) => {
      if (window.__originalOrientationPromise) {
        window.Capacitor.nativePromise = window.__originalOrientationPromise
        delete window.__originalOrientationPromise
        await window.Capacitor.nativePromise('ScreenOrientation', 'unlock', {})
      }
      if (window.__originalRequestFullscreen) Element.prototype.requestFullscreen = window.__originalRequestFullscreen
      if (window.__originalExitFullscreen) document.exitFullscreen = window.__originalExitFullscreen
      delete window.__originalRequestFullscreen
      delete window.__originalExitFullscreen
      delete window.__swipeFullscreenFrames
      if (document.fullscreenElement) await document.exitFullscreen()
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
      if (window.__fullscreenTransitionFetch) window.fetch = window.__fullscreenTransitionFetch
      delete window.__fullscreenTransitionFetch
      delete window.__fullscreenReentered
      delete window.__landscapeExitRetained
      delete window.__transitionFrames
      delete window.__transitionFinished
      location.hash = originalRoute
    }, { settings, originalRoute })
    await page.emulateMedia({ reducedMotion: null })
    await watch?.dispose()
    await session.detach()
    await browser.close()
  }
})
