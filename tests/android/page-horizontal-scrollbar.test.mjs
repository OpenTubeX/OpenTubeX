import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'

// Install a current debug APK and hold the emulator's lab lock. Forward its
// WebView socket to ANDROID_CDP_URL and set ANDROID_SERIAL to its ADB serial.
test('Android draws no native horizontal page scrollbar for sub-pixel overflow', {
  skip: !process.env.ANDROID_CDP_URL || !process.env.ANDROID_SERIAL,
}, async () => {
  assert.match(process.env.ANDROID_SERIAL, /^emulator-\d+$/)
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const originalRoute = await page.evaluate(() => location.hash)
  let settings
  try {
    await page.locator('.profileTrigger').waitFor()
    settings = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      // Persistent scrollbars keep Android's native page scrollbars drawn, so
      // the check needs no timing around their fade.
      const values = { AlwaysShowScrollbars: true, UiScale: 95 }
      const saved = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      location.hash = '#/history'
      return saved
    })
    await expect.poll(() => page.evaluate(() => document.querySelector('meta[name="viewport"]').content))
      .toContain('initial-scale=0.9')
    const backdrop = await page.evaluate(async () => {
      // Content ending a fraction of a pixel past the layout viewport, as
      // fractional UI scales produce. Blink rounds it out of scrollWidth, yet
      // Android still receives a horizontal scroll range.
      const overflow = document.createElement('div')
      overflow.id = 'page-horizontal-scrollbar-test-overflow'
      overflow.style.cssText = 'position: absolute; inset-block-start: 0; inset-inline-start: 0; ' +
        'inline-size: calc(100% + 0.75px); block-size: 3000px; pointer-events: none;'
      // Give the native scrollbar a backdrop along the bottom edge, in a color
      // the screenshot can locate.
      const backdrop = document.createElement('div')
      backdrop.id = 'page-horizontal-scrollbar-test-backdrop'
      backdrop.style.cssText = 'position: fixed; inset-inline: 0; inset-block-end: 0; block-size: 48px; ' +
        'background: #f0f; z-index: 2147483647; pointer-events: none;'
      document.body.append(overflow, backdrop)
      return {
        height: Math.floor(backdrop.getBoundingClientRect().height * visualViewport.scale * devicePixelRatio),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    assert.ok(backdrop.overflow <= 1, 'The overflow stays below a whole CSS pixel')

    const nativeScrollbars = async () => {
      // Each scroll wakes the native scrollbars in case Android drew a frame
      // before the persistent scrollbar setting arrived.
      await page.evaluate(() => new Promise(resolve => {
        scrollTo(0, scrollY < 150 ? 200 : 100)
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }))
      // CDP screenshots omit Android's native scrollbars, so capture the device.
      const png = execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'exec-out', 'screencap', '-p'],
        { maxBuffer: 64 * 1024 * 1024 }).toString('base64')
      return page.evaluate(async ({ png, height }) => {
        const bitmap = await createImageBitmap(new Blob([
          Uint8Array.from(atob(png), character => character.charCodeAt(0)),
        ], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d')
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        const isMagenta = (pixels, i) => pixels[i] > 250 && pixels[i + 1] < 5 && pixels[i + 2] > 250
        const edge = context.getImageData(2, 0, 1, canvas.height).data
        let top = 0
        while (top < canvas.height && !isMagenta(edge, top * 4)) top++
        // Stay clear of the vertical scrollbar along the right edge. A
        // horizontal scrollbar tints whole rows of the backdrop.
        const width = Math.round(canvas.width * 0.8)
        // The backdrop's device height can round past its real edge.
        const rows = Math.min(height, canvas.height - top) - 4
        const pixels = rows > 0 ? context.getImageData(0, top, width, rows).data : []
        let horizontal = 0
        for (let y = 0; y < rows; y++) {
          let tinted = 0
          for (let x = 0; x < width; x++) if (!isMagenta(pixels, (y * width + x) * 4)) tinted++
          if (tinted > width * 0.95) horizontal++
        }
        const column = context.getImageData(canvas.width - 3, Math.round(canvas.height * 0.08),
          1, Math.round(canvas.height * 0.7)).data
        let vertical = 0
        for (let i = 0; i < column.length; i += 4) {
          if (column[i] > 40 && column[i] < 230 && Math.abs(column[i] - column[i + 1]) < 3 &&
            Math.abs(column[i] - column[i + 2]) < 3) vertical++
        }
        return { backdrop: top < canvas.height, horizontal, vertical }
      }, { png, height: backdrop.height })
    }

    // Wait until Android draws its persistent vertical page scrollbar. Its
    // horizontal scroll range can update a few frames later, so keep checking
    // for a while: a horizontal scrollbar tints whole backdrop rows.
    await expect.poll(async () => {
      const { backdrop, vertical } = await nativeScrollbars()
      return backdrop && vertical > 20
    }, { message: 'Android draws the vertical page scrollbar above the backdrop', timeout: 15000 }).toBe(true)
    for (let check = 0; check < 6; check++) {
      await new Promise(resolve => setTimeout(resolve, 250))
      assert.equal((await nativeScrollbars()).horizontal, 0, 'No native horizontal page scrollbar')
    }
  } finally {
    await page.evaluate(({ settings, originalRoute }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(settings ?? {})) store.commit('set' + key, value)
      document.querySelector('#page-horizontal-scrollbar-test-overflow')?.remove()
      document.querySelector('#page-horizontal-scrollbar-test-backdrop')?.remove()
      location.hash = originalRoute
    }, { settings, originalRoute })
    await browser.close()
  }
})
