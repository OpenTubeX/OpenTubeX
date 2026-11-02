import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'

// Install a current debug APK and hold the emulator's lab lock. Forward its
// WebView socket to ANDROID_CDP_URL and set ANDROID_SERIAL to its ADB serial.
test('Always show scrollbars keeps the native page scrollbar when enabled while it is about to fade', {
  skip: !process.env.ANDROID_CDP_URL || !process.env.ANDROID_SERIAL,
}, async () => {
  assert.match(process.env.ANDROID_SERIAL, /^emulator-\d+$/)
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const setAlwaysShowScrollbars = enabled => page.evaluate(enabled => document.querySelector('#app').__vue_app__
    .config.globalProperties.$store.commit('setAlwaysShowScrollbars', enabled), enabled)
  let original
  try {
    await page.locator('.profileTrigger').waitFor()
    original = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const spacer = document.createElement('div')
      spacer.id = 'always-show-scrollbars-test-spacer'
      spacer.style.height = '3000px'
      document.querySelector('.tabContent[aria-hidden="false"]').append(spacer)
      // A white cover keeps page content out of the sampled column; the
      // native scrollbar draws above the WebView's content.
      const cover = document.createElement('div')
      cover.id = 'always-show-scrollbars-test-cover'
      cover.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647; background: #fff'
      document.body.append(cover)
      return store.getters.getAlwaysShowScrollbars
    })

    const nativeScrollbarPixels = () => {
      // CDP screenshots omit Android's native scrollbar, so capture the device.
      const png = execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'exec-out', 'screencap', '-p']).toString('base64')
      return page.evaluate(async png => {
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
          1, Math.round(canvas.height * 0.84)).data
        let gray = 0
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 40 && pixels[i] < 230 && Math.abs(pixels[i] - pixels[i + 1]) < 3 &&
            Math.abs(pixels[i] - pixels[i + 2]) < 3) gray++
        }
        return gray
      }, png)
    }

    await setAlwaysShowScrollbars(false)
    await page.evaluate(() => scrollTo(0, 0))
    await expect.poll(nativeScrollbarPixels, { message: 'The scrollbar fades while fading is enabled' }).toBe(0)

    // Scrolling schedules a fade. Enabling the setting before it starts used
    // to let that fade hide the scrollbar until the setting changed again.
    await page.evaluate(() => scrollTo(0, 400))
    await setAlwaysShowScrollbars(true)
    await page.waitForTimeout(3000)
    assert.ok(await nativeScrollbarPixels() > 0, 'The native scrollbar is hidden although Always show scrollbars is on')
    await page.evaluate(() => scrollTo(0, 800))
    await page.waitForTimeout(3000)
    assert.ok(await nativeScrollbarPixels() > 0, 'The native scrollbar faded after scrolling again')
  } finally {
    await page.evaluate(() => {
      document.querySelector('#always-show-scrollbars-test-spacer')?.remove()
      document.querySelector('#always-show-scrollbars-test-cover')?.remove()
      scrollTo(0, 0)
    }).catch(() => {})
    if (original !== undefined) await setAlwaysShowScrollbars(original).catch(() => {})
    await browser.close()
  }
})
