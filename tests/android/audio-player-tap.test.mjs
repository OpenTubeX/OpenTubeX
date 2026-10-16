import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Run against a current debug APK on a locked emulator with its WebView
// socket forwarded to ANDROID_CDP_URL.
test('audio surface taps toggle controls without interrupting playback', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  const session = await context.newCDPSession(page)
  const originalRoute = await page.evaluate(() => location.hash)
  let settings
  let watch
  try {
    await page.reload()
    await page.locator('.profileTrigger').waitFor()
    const tutorial = page.locator('.tutorialOverlay')
    if (await tutorial.isVisible()) {
      await tutorial.getByRole('button', { name: 'Skip', exact: true }).click()
      await expect(tutorial).toBeHidden()
    }
    settings = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        VideoPlaybackEngine: 'built-in',
        AutoplayVideos: false,
        UseSponsorBlock: false,
        UseReturnYouTubeDislikes: false,
        RotateFullscreenToLandscape: false,
        EnterFullscreenOnDisplayRotate: false,
        PlayingInterfaceHideDelay: 30,
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.__audioTapFetch = window.fetch
      window.fetch = (url, options) => /^(https:\/\/localhost\/|data:|blob:)/.test(String(url))
        ? window.__audioTapFetch(url, options)
        : Promise.reject(new Error('Offline audio tap test'))
      const style = document.createElement('style')
      style.id = 'audio-tap-test-style'
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
    const media = (await readFile(new URL('../../e2e/fixtures/media/demo-audio.mp3', import.meta.url))).toString('base64')
    const thumbnail = (await readFile(new URL('../../e2e/fixtures/media/video-thumbnail.svg', import.meta.url))).toString('base64')
    await watch.evaluate((component, { media, thumbnail }) => {
      const watch = component.proxy
      watch.videoLoadGeneration++
      Object.assign(watch, {
        isLoading: false,
        ytDlpStreamsPending: false,
        errorMessage: null,
        isUpcoming: false,
        isLive: false,
        localFilePlayback: true,
        activeFormat: 'audio',
        legacyFormats: [],
        manifestSrc: `data:audio/mpeg;base64,${media}`,
        manifestMimeType: 'audio/mpeg',
        videoTitle: 'Audio player tap test',
        channelName: 'Offline test channel',
        videoLengthSeconds: 60,
        thumbnail: `data:image/svg+xml;base64,${thumbnail}`,
      })
    }, { media, thumbnail })
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    const controls = player.locator('.shaka-controls-container')
    await expect(player).toHaveClass(/musicAudioPlayer/)
    await expect.poll(() => video.evaluate(element => element.readyState), { timeout: 15000 }).toBe(4)
    await video.evaluate(element => { element.loop = true; return element.play() })
    const tapAt = async (x, y) => {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x, y }],
      })
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    for (const fullscreen of [false, true]) {
      if (fullscreen) {
        await controls.evaluate(element => element.setAttribute('shown', 'true'))
        await player.locator('.shaka-fullscreen-button').click()
        await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
      }
      for (const paused of [false, true]) {
        await video.evaluate((element, paused) => paused ? element.pause() : element.play(), paused)
        await controls.evaluate(element => element.removeAttribute('shown'))
        for (const shown of [true, false, true]) {
          const bounds = await player.boundingBox()
          await tapAt(bounds.x + bounds.width / 2, bounds.y + bounds.height / 4)
          if (shown) await expect(controls).toHaveAttribute('shown', 'true')
          else await expect(controls).not.toHaveAttribute('shown')
          assert.equal(await video.evaluate(element => element.paused), paused, 'Surface taps must preserve playback state')
          if (process.env.ANDROID_ARTIFACT_DIR) {
            await page.waitForTimeout(400)
            await page.screenshot({ path: `${process.env.ANDROID_ARTIFACT_DIR}/audio-tap-${fullscreen ? 'fullscreen' : 'inline'}-${paused ? 'paused' : 'playing'}-${shown ? 'shown' : 'hidden'}.png` })
          }
        }
      }
      // The central button must still own its tap when controls are visible.
      const playButton = await player.locator('.shaka-big-buttons-container .shaka-play-button').boundingBox()
      await tapAt(playButton.x + playButton.width / 2, playButton.y + playButton.height / 2)
      await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
    }
  } finally {
    await page.evaluate(async ({ settings, originalRoute }) => {
      if (document.fullscreenElement) await document.exitFullscreen()
      document.querySelectorAll('.ftVideoPlayer video').forEach(video => video.pause())
      if (window.__audioTapFetch) {
        window.fetch = window.__audioTapFetch
        delete window.__audioTapFetch
      }
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
      document.querySelector('#audio-tap-test-style')?.remove()
      location.hash = originalRoute
    }, { settings, originalRoute })
    await watch?.dispose()
    await session.detach()
    await browser.close()
  }
})
