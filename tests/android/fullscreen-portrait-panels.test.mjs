import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Run against a current debug APK on a locked emulator with its WebView
// socket forwarded to ANDROID_CDP_URL.
test('offline audio fullscreen queue uses a draggable portrait bottom panel', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  const session = await context.newCDPSession(page)
  const originalRoute = await page.evaluate(() => location.hash)
  let settings
  let watch
  let addedQueueIds = []
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
        videoTitle: 'Portrait fullscreen audio',
        channelName: 'Offline test channel',
        videoLengthSeconds: 60,
        thumbnail: `data:image/svg+xml;base64,${thumbnail}`,
      })
    }, { media, thumbnail })
    const player = page.locator('.ftVideoPlayer')
    const video = player.locator('video')
    await expect.poll(() => video.evaluate(element => element.readyState)).toBe(4)
    await player.evaluate(element => element.requestFullscreen())
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
    assert.equal(await page.evaluate(() => matchMedia('(orientation: portrait)').matches), true)
    addedQueueIds = await watch.evaluate(component => {
      const store = component.proxy.$store
      const previousIds = new Set(store.getters.getWatchQueue.map(item => item.queueItemId))
      for (let index = 0; index < 30; index++) {
        component.proxy.$store.commit('addVideoToWatchQueue', {
          video: { videoId: `portrait${String(index).padStart(3, '0')}`, title: `Offline queue item ${index + 1}`, author: 'Audio library' }
        })
      }
      return store.getters.getWatchQueue.filter(item => !previousIds.has(item.queueItemId)).map(item => item.queueItemId)
    })
    await watch.evaluate(component => component.proxy.$refs.player.setFullscreenQueue(true))
    const sheet = player.locator('.fullscreenDockSheet[open]')
    await expect(sheet).toBeVisible()
    await expect.poll(() => sheet.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Math.abs(bounds.width - innerWidth) < 1 && Math.abs(bounds.top - innerHeight * 0.3) < 2
    })).toBe(true)
    const queue = sheet.locator('.queueItems')
    await expect(queue).toHaveAttribute('data-overlayscrollbars-viewport')
    await queue.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => queue.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await queue.evaluate(element => { element.scrollTop = 0 })
    if (process.env.ANDROID_ARTIFACT_DIR) {
      await page.screenshot({ path: `${process.env.ANDROID_ARTIFACT_DIR}/portrait-fullscreen-audio-queue.png` })
    }
    const header = await sheet.locator('.fullscreenDockHeader').boundingBox()
    const x = header.x + header.width / 2
    const y = header.y + 20
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (const offset of [30, 60, 90, 120]) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + offset }] })
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(sheet).toHaveCount(0)
    assert.equal(await page.evaluate(() => !!document.fullscreenElement), true)
    if (process.env.ANDROID_SERIAL) {
      await watch.evaluate(component => component.proxy.$refs.player.setFullscreenQueue(true))
      await expect(sheet).toBeVisible()
      execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'shell', 'input', 'keyevent', '4'])
      await expect(sheet).toHaveCount(0)
      assert.equal(await page.evaluate(() => !!document.fullscreenElement), true)
    }
  } finally {
    await page.evaluate(async ({ settings, originalRoute, addedQueueIds }) => {
      if (document.fullscreenElement) await document.exitFullscreen()
      document.querySelectorAll('.ftVideoPlayer video').forEach(video => video.pause())
      if (window.__audioTapFetch) {
        window.fetch = window.__audioTapFetch
        delete window.__audioTapFetch
      }
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const id of addedQueueIds) store.commit('removeVideoFromWatchQueue', id)
      for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
      document.querySelector('#audio-tap-test-style')?.remove()
      location.hash = originalRoute
    }, { settings, originalRoute, addedQueueIds })
    await watch?.dispose()
    await session.detach()
    await browser.close()
  }
})
