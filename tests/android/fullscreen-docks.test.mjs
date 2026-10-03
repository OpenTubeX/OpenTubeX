import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'
import { measureFullscreenDockToggle } from '../../e2e/helpers/fullscreen-docks.mjs'

// Run on a locked emulator with a current debug APK and a forwarded WebView.
test('Android fullscreen docks animate without reflowing the player every frame', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const originalRoute = await page.evaluate(() => location.hash)
  let settings
  let watch
  try {
    await page.locator('.profileTrigger').waitFor()
    settings = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        VideoPlaybackEngine: 'built-in', AutoplayVideos: false,
        UseSponsorBlock: false, UseReturnYouTubeDislikes: false,
        RotateFullscreenToLandscape: false, EnterFullscreenOnDisplayRotate: false,
        ReducedMotion: 'off', AnimationSpeed: 100,
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) {
        if (key === 'ReducedMotion' || key === 'AnimationSpeed') await store.dispatch('update' + key, value)
        else store.commit('set' + key, value)
      }
      window.__fullscreenDocksFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__fullscreenDocksFetch(url, options) : Promise.reject(new Error('Offline dock test'))
      const style = document.createElement('style')
      style.id = 'fullscreen-docks-test-style'
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
        isUpcoming: false, isLive: false, localFilePlayback: false, activeFormat: 'legacy',
        videoTitle: 'Fullscreen dock performance test', videoLengthSeconds: 60,
        legacyFormats: [{ itag: 0, qualityLabel: 'Test', mimeType: 'video/webm',
          width: 320, height: 180, bitrate: 0, localFile: true, url: `data:video/webm;base64,${media}` }],
      })
    }, media)
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    await expect.poll(() => video.evaluate(element => element.readyState)).toBe(4)
    await video.evaluate(element => { element.loop = true; return element.play() })
    await player.evaluate(element => element.requestFullscreen())
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
    await expect(player).not.toHaveClass(/presentationModeChanging/)
    const initialWidth = await video.evaluate(element => element.clientWidth)
    for (const open of [true, false, true, false]) {
      const samples = await measureFullscreenDockToggle(watch, open)
      console.log(JSON.stringify({ open, ...samples }))
      assert.ok(samples.widths.length <= 2, 'Video must lay out once per toggle')
      assert.ok(samples.controlWidths.length <= 2, 'Controls must lay out once per toggle')
      assert.equal(samples.animationKeyframes.length, 2, 'The video uses a compositor animation even when the emulator drops frames')
      assert.notEqual(samples.animationKeyframes[0].scale, samples.animationKeyframes[1].scale)
      if (open) {
        await expect(player.locator('.fullscreenMetadataOverlay.open')).toBeVisible()
        assert.ok(samples.widths.at(-1) < initialWidth)
      } else {
        assert.equal(samples.widths.at(-1), initialWidth)
      }
      assert.equal(await video.evaluate(element => element.getAnimations().length), 0)
    }
    assert.equal(await video.evaluate(element => element.paused), false)
  } finally {
    await page.evaluate(async ({ settings, originalRoute }) => {
      if (document.fullscreenElement) await document.exitFullscreen()
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(settings ?? {})) {
        if (key === 'ReducedMotion' || key === 'AnimationSpeed') await store.dispatch('update' + key, value)
        else store.commit('set' + key, value)
      }
      if (window.__fullscreenDocksFetch) window.fetch = window.__fullscreenDocksFetch
      delete window.__fullscreenDocksFetch
      document.querySelector('#fullscreen-docks-test-style')?.remove()
      location.hash = originalRoute
    }, { settings, originalRoute })
    await watch?.dispose()
    await browser.close()
  }
})
