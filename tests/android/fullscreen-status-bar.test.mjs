import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Run against a current debug APK on a locked emulator, forwarding its WebView
// socket and setting ANDROID_CDP_URL=http://127.0.0.1:<forwarded-port> and ANDROID_SERIAL.
test('fullscreen hides the status bar again after closing the notification shade', {
  skip: !process.env.ANDROID_CDP_URL || !process.env.ANDROID_SERIAL,
}, async () => {
  assert.match(process.env.ANDROID_SERIAL, /^emulator-\d+$/)
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
        RotateFullscreenToLandscape: true,
        EnterFullscreenOnDisplayRotate: false,
        PlayingInterfaceHideDelay: 5,
        MobileLeftSwipeAction: 'disabled',
        MobileRightSwipeAction: 'disabled',
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.__fullscreenStatusBarFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__fullscreenStatusBarFetch(url, options)
        : Promise.reject(new Error('Offline fullscreen test'))
      const style = document.createElement('style')
      style.id = 'fullscreen-status-bar-test-style'
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
        videoTitle: 'Fullscreen status bar test',
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
    // A saved position from seek tests can loop this short fixture mid-assertion.
    await video.evaluate(video => { video.currentTime = 0; video.loop = true; return video.play() })
    await expect.poll(() => video.evaluate(video => video.paused)).toBe(false)
    await player.evaluate(element => element.ui.getControls().hideUI())
    await expect(controls).not.toHaveAttribute('shown', { timeout: 10000 })

    const adb = (...args) => execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'shell', ...args], { encoding: 'utf8' })
    const apiLevel = Number(adb('getprop', 'ro.build.version.sdk').trim())
    const statusBarState = () => {
      if (apiLevel >= 30) {
        const displays = adb('dumpsys', 'window', 'displays')
        const visible = displays.match(/mSource=InsetsSource[^\n]*type=statusBars[^\n]*visible=(true|false)/)?.[1]
        assert.ok(visible, 'Read the native status bar inset provider')
        return visible === 'true' ? 'WINDOW_STATE_SHOWING' : 'WINDOW_STATE_HIDDEN'
      }
      const policy = adb('dumpsys', 'window', 'policy')
      const state = policy.match(/BarController.StatusBar\s+mState=(\w+)/)?.[1]
      assert.ok(state, 'Read the real native status bar visibility')
      return state
    }
    await session.send('Runtime.evaluate', {
      expression: "document.querySelector('.ftVideoPlayer').ui.getControls().toggleFullScreen()",
      awaitPromise: true,
      userGesture: true,
    })
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
    await player.evaluate(element => element.ui.getControls().hideUI())
    await expect(controls).not.toHaveAttribute('shown', { timeout: 10000 })
    await expect.poll(statusBarState).toBe('WINDOW_STATE_HIDDEN')
    const screenshot = execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'exec-out', 'screencap', '-p'])
    const x = Math.round(screenshot.readUInt32BE(16) / 2)
    const height = screenshot.readUInt32BE(20)
    adb('input', 'swipe', String(x), '1', String(x), String(Math.round(height * 0.7)), '500')
    adb('input', 'swipe', String(x), '1', String(x), String(Math.round(height * 0.7)), '500')
    adb('cmd', 'statusbar', 'expand-notifications')
    await expect.poll(() => adb('dumpsys', 'window').match(/mCurrentFocus=([^\n]*)/)?.[1]).toMatch(/NotificationShade|StatusBar/)
    // Simulate the idle timer hiding controls while the shade still owns focus.
    // Android can override that hide request; the cached preference must be retried.
    await player.evaluate(element => element.ui.getControls().hideUI())
    await expect(controls).not.toHaveAttribute('shown')
    adb('cmd', 'statusbar', 'collapse')
    await expect.poll(() => adb('dumpsys', 'window').match(/mCurrentFocus=([^\n]*)/)?.[1]).toContain('org.opentubex.app.dev')
    await player.evaluate(element => element.ui.getControls().hideUI())
    await expect(controls).not.toHaveAttribute('shown', { timeout: 10000 })
    if (process.env.ANDROID_EVIDENCE_PATH) {
      await page.waitForTimeout(1000)
      await writeFile(process.env.ANDROID_EVIDENCE_PATH,
        execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'exec-out', 'screencap', '-p']))
    }
    await expect.poll(statusBarState, {
      timeout: 10000,
      message: 'Status bar hides again after closing the notification shade with idle fullscreen controls',
    }).toBe('WINDOW_STATE_HIDDEN')
    assert.equal(await video.evaluate(video => video.paused), false)
    assert.equal(await page.evaluate(() => !!document.fullscreenElement), true)

    // Restoring focus must also preserve the bar when controls are visible.
    await player.evaluate(element => element.ui.getControls().showUI())
    await expect.poll(statusBarState).toBe('WINDOW_STATE_SHOWING')
    adb('cmd', 'statusbar', 'expand-notifications')
    await expect.poll(() => adb('dumpsys', 'window').match(/mCurrentFocus=([^\n]*)/)?.[1]).toMatch(/NotificationShade|StatusBar/)
    adb('cmd', 'statusbar', 'collapse')
    await expect.poll(() => adb('dumpsys', 'window').match(/mCurrentFocus=([^\n]*)/)?.[1]).toContain('org.opentubex.app.dev')
    await expect(controls).toHaveAttribute('shown', 'true')
    await expect.poll(statusBarState).toBe('WINDOW_STATE_SHOWING')
    await player.evaluate(element => element.ui.getControls().hideUI())
    await expect.poll(statusBarState).toBe('WINDOW_STATE_HIDDEN')
    await page.evaluate(() => document.exitFullscreen())
    await expect.poll(statusBarState).toBe('WINDOW_STATE_SHOWING')
  } finally {
    execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'shell', 'cmd', 'statusbar', 'collapse'])
    await page.evaluate(async ({ settings, originalRoute }) => {
      if (document.fullscreenElement) await document.exitFullscreen()
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
      if (window.__fullscreenStatusBarFetch) window.fetch = window.__fullscreenStatusBarFetch
      delete window.__fullscreenStatusBarFetch
      document.querySelector('#fullscreen-status-bar-test-style')?.remove()
      location.hash = originalRoute
    }, { settings, originalRoute })
    await watch?.dispose()
    await session.detach()
    await browser.close()
  }
})
