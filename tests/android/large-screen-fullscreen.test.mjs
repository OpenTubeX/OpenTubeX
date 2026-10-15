import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import test from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

const run = promisify(execFile)

// Use a current debug APK on a locked emulator with its WebView forwarded.
test('Android 17 fullscreen and playback survive large-screen resizing at fractional UI scales', {
  skip: !process.env.ANDROID_CDP_URL || !process.env.ANDROID_LARGE_SCREEN_SERIAL,
  timeout: 180000,
}, async () => {
  const serial = process.env.ANDROID_LARGE_SCREEN_SERIAL
  assert.match(serial, /^emulator-\d+$/)
  const adb = async (...args) => (await run('adb', ['-s', serial, ...args], { timeout: 20000 })).stdout
  assert.equal((await adb('shell', 'getprop', 'ro.build.version.sdk')).trim(), '37')
  const originalSize = (await adb('shell', 'wm', 'size')).match(/Override size: (\d+x\d+)/)?.[1]
  const originalDensity = (await adb('shell', 'wm', 'density')).match(/Override density: (\d+)/)?.[1]
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  const session = await context.newCDPSession(page)
  let saved
  let watch
  try {
    await adb('shell', 'wm', 'density', '240')
    await adb('shell', 'wm', 'size', '1600x2560')
    await page.locator('.profileTrigger').waitFor()
    saved = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        VideoPlaybackEngine: 'built-in',
        AutoplayVideos: false,
        UseSponsorBlock: false,
        UseReturnYouTubeDislikes: false,
        RotateFullscreenToLandscape: true,
        EnterFullscreenOnDisplayRotate: false,
        UiScale: 100,
        CapacitorLayoutMode: 'auto'
      }
      const settings = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.__largeScreenFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__largeScreenFetch(url, options)
        : Promise.reject(new Error('Offline resize test'))
      const style = document.createElement('style')
      style.id = 'large-screen-test-style'
      style.textContent = '.tutorialOverlay { display: none !important; }'
      document.head.append(style)
      const route = location.hash
      location.hash = '#/watch/jNQXAC9IVRw'
      return { settings, route }
    })
    await expect.poll(async () => {
      const component = await page.evaluateHandle(findWatchComponent)
      try { return await component.evaluate(component => !!component && component.proxy.preparingVideoLoadGeneration === null) } finally { await component.dispose() }
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
        videoTitle: 'Android 17 tablet playback',
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
        }]
      })
    }, media)
    const video = page.locator('.ftVideoPlayer video')
    await expect.poll(() => video.evaluate(video => video.readyState)).toBe(4)
    await expect(page.locator('.shaka-fullscreen-button')).toBeEnabled()
    await video.evaluate(video => { video.loop = true; video.currentTime = 0; return video.play() })
    for (const scale of [100, 125]) {
      await page.evaluate(scale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', scale), scale)
      await expect.poll(() => page.evaluate(() => Math.min(innerWidth, innerHeight))).toBeGreaterThanOrEqual(600)
      const fullscreen = await session.send('Runtime.evaluate', {
        expression: "document.querySelector('.shaka-controls-container').setAttribute('shown', 'true'); document.querySelector('.shaka-fullscreen-button').click()",
        userGesture: true,
      })
      assert.equal(fullscreen.exceptionDetails, undefined)
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
      for (const [size, landscape] of [['2560x1600', true], ['1600x2560', false]]) {
        await adb('shell', 'wm', 'size', size)
        await expect.poll(() => page.evaluate(() => innerWidth > innerHeight)).toBe(landscape)
        await expect.poll(() => page.locator('.ftVideoPlayer').evaluate(player => {
          const rect = player.getBoundingClientRect()
          return Math.abs(rect.x) < 2 && Math.abs(rect.y) < 2 &&
            Math.abs(rect.width - innerWidth) < 2 && Math.abs(rect.height - innerHeight) < 2
        })).toBe(true)
        assert.equal(await video.evaluate(video => video.paused), false)
        const frames = await video.evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames)
        await expect.poll(() => video.evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(frames)
      }
      await page.evaluate(() => document.exitFullscreen())
      await expect(page.locator('.ftVideoPlayer')).not.toHaveClass(/fullWindow/)
      assert.equal(await video.evaluate(video => video.paused), false)
    }
    if (process.env.ANDROID_LARGE_SCREEN_SCREENSHOT) await page.screenshot({ path: process.env.ANDROID_LARGE_SCREEN_SCREENSHOT })
  } catch (error) {
    console.error(await page.evaluate(() => ({
      viewport: [innerWidth, innerHeight],
      fullscreenEnabled: document.fullscreenEnabled,
      fullscreen: !!document.fullscreenElement,
      controls: [...document.querySelectorAll('.shaka-fullscreen-button')].map(button => ({ disabled: button.disabled, text: button.textContent })),
      players: [...document.querySelectorAll('.ftVideoPlayer')].map(player => ({ classes: player.className, bounds: player.getBoundingClientRect().toJSON() })),
      settings: !!document.querySelector('.settingsWindow'),
    })).catch(diagnosticError => ({ diagnosticError: diagnosticError.message })))
    throw error
  } finally {
    try {
      await page.evaluate(async saved => {
        if (document.fullscreenElement) await document.exitFullscreen()
        document.querySelector('video')?.pause()
        if (saved) {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          for (const [key, value] of Object.entries(saved.settings)) store.commit('set' + key, value)
          location.hash = saved.route
        }
        if (window.__largeScreenFetch) window.fetch = window.__largeScreenFetch
        delete window.__largeScreenFetch
        document.querySelector('#large-screen-test-style')?.remove()
      }, saved)
    } finally {
      try {
        await adb('shell', 'wm', 'size', originalSize ?? 'reset')
          .finally(() => adb('shell', 'wm', 'density', originalDensity ?? 'reset'))
      } finally {
        await watch?.dispose().catch(() => {})
        await session.detach().catch(() => {})
        await browser.close()
      }
    }
  }
})
