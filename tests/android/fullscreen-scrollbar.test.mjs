import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

// Install a current debug APK and hold the emulator's lab lock. Forward its
// WebView socket to ANDROID_CDP_URL and set ANDROID_SERIAL to its ADB serial.
test('Android hides its native page scrollbar throughout fullscreen and restores it on exit', {
  skip: !process.env.ANDROID_CDP_URL || !process.env.ANDROID_SERIAL,
}, async () => {
  assert.match(process.env.ANDROID_SERIAL, /^emulator-\d+$/)
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const session = await browser.contexts()[0].newCDPSession(page)
  const originalRoute = await page.evaluate(() => location.hash)
  let settings
  let watch
  try {
    await page.locator('.profileTrigger').waitFor()
    settings = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        VideoPlaybackEngine: 'built-in',
        AutoplayVideos: false,
        UseSponsorBlock: false,
        UseReturnYouTubeDislikes: false,
        RotateFullscreenToLandscape: false,
        EnterFullscreenOnDisplayRotate: false,
        AlwaysShowScrollbars: true,
        CapacitorLayoutMode: 'phone',
        UiScale: 100,
      }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      window.__fullscreenScrollbarFetch = window.fetch
      window.fetch = (url, options) => String(url).startsWith('https://localhost/')
        ? window.__fullscreenScrollbarFetch(url, options)
        : Promise.reject(new Error('Offline scrollbar test'))
      const style = document.createElement('style')
      style.id = 'fullscreen-scrollbar-test-style'
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
        videoTitle: 'Fullscreen scrollbar test',
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
    await expect.poll(() => video.evaluate(element => element.readyState)).toBe(4)
    await page.evaluate(() => {
      const spacer = document.createElement('div')
      spacer.id = 'fullscreen-scrollbar-test-spacer'
      spacer.style.height = '3000px'
      document.querySelector('.tabContent[aria-hidden="false"]').append(spacer)
      scrollTo(0, 50)
    })
    await expect.poll(() => page.evaluate(() => Math.abs(scrollY - 50))).toBeLessThan(1)
    await video.evaluate(element => { element.loop = true; return element.play() })

    const nativeScrollbarPixels = async () => {
      // CDP screenshots omit Android's native scrollbar. Capture the device,
      // hiding player artwork/controls without changing layout or scroll range.
      const style = await page.addStyleTag({ content: '.ftVideoPlayer > * { visibility: hidden !important; }' })
      try {
        const png = execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'exec-out', 'screencap', '-p']).toString('base64')
        return await page.evaluate(async png => {
          const bitmap = await createImageBitmap(new Blob([
            Uint8Array.from(atob(png), character => character.charCodeAt(0)),
          ], { type: 'image/png' }))
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          const context = canvas.getContext('2d')
          context.drawImage(bitmap, 0, 0)
          bitmap.close()
          const pixels = context.getImageData(canvas.width - 3, Math.round(canvas.height * 0.08),
            1, Math.round(canvas.height * 0.7)).data
          let gray = 0
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] > 40 && pixels[i] < 230 && Math.abs(pixels[i] - pixels[i + 1]) < 3 &&
              Math.abs(pixels[i] - pixels[i + 2]) < 3) gray++
          }
          return gray
        }, png)
      } finally {
        await style.evaluate(element => element.remove())
      }
    }

    for (const scale of [100, 125]) {
      await page.evaluate(scale => {
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', scale)
        document.querySelector('.shaka-controls-container').setAttribute('shown', 'true')
      }, scale)
      await session.send('Runtime.evaluate', {
        expression: "document.querySelector('.videoLayout').requestFullscreen()",
        userGesture: true,
        awaitPromise: true,
      })
      await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
      await expect.poll(nativeScrollbarPixels, { message: `No native scrollbar in fullscreen at ${scale}% scale` }).toBe(0)
      for (const enabled of [false, true]) {
        await page.evaluate(enabled => document.querySelector('#app').__vue_app__.config.globalProperties.$store
          .commit('setAlwaysShowScrollbars', enabled), enabled)
        await expect.poll(nativeScrollbarPixels).toBe(0)
      }
      await page.evaluate(() => document.exitFullscreen())
      await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
      await expect.poll(nativeScrollbarPixels, { message: 'Restore the persistent page scrollbar on exit' }).toBeGreaterThan(20)
    }
  } finally {
    await page.evaluate(async ({ settings, originalRoute }) => {
      if (document.fullscreenElement) await document.exitFullscreen()
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
      if (window.__fullscreenScrollbarFetch) window.fetch = window.__fullscreenScrollbarFetch
      delete window.__fullscreenScrollbarFetch
      document.querySelector('#fullscreen-scrollbar-test-style')?.remove()
      document.querySelector('#fullscreen-scrollbar-test-spacer')?.remove()
      location.hash = originalRoute
    }, { settings, originalRoute })
    await watch?.dispose()
    await session.detach()
    await browser.close()
  }
})
