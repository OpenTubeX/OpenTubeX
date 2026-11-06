import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'

// Install a current debug APK and hold the emulator's lab lock. Forward its
// WebView socket to ANDROID_CDP_URL and set ANDROID_SERIAL to its ADB serial.
test('maximized settings hides Android’s page scrollbar and restores it on close', {
  skip: !process.env.ANDROID_CDP_URL || !process.env.ANDROID_SERIAL,
}, async () => {
  assert.match(process.env.ANDROID_SERIAL, /^emulator-\d+$/)
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  let original
  try {
    await page.locator('.profileTrigger').waitFor()
    original = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = { AlwaysShowScrollbars: true, CapacitorLayoutMode: 'phone', UiScale: 100 }
      const settings = Object.fromEntries(Object.keys(values).map(key => [key, structuredClone(store.getters['get' + key])]))
      for (const [key, value] of Object.entries(values)) store.commit('set' + key, value)
      const spacer = document.createElement('div')
      spacer.id = 'settings-scrollbar-test-spacer'
      spacer.style.height = '3000px'
      document.body.append(spacer)
      // Android draws above even the highest CSS layer. Cover the themed
      // scrollbars so device pixels isolate the unwanted native scrollbar.
      const cover = document.createElement('div')
      cover.id = 'settings-scrollbar-test-cover'
      cover.style.cssText = 'position: fixed; inset: 0 0 0 auto; width: 12px; z-index: 2147483647; background: #fff; pointer-events: none'
      document.body.append(cover)
      const scrollTop = scrollY
      scrollTo(0, 400)
      return { settings, scrollTop }
    })
    const nativeScrollbarPixels = () => {
      // Read raw device pixels on the host: CDP omits the native scrollbar.
      const capture = execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'exec-out', 'screencap'],
        { maxBuffer: 64 * 1024 * 1024 })
      const width = capture.readUInt32LE(0)
      const height = capture.readUInt32LE(4)
      assert.equal(capture.readUInt32LE(8), 1, 'The device capture uses RGBA_8888')
      // New Android versions add a color-space field after the dimensions
      // and format. Pixel data follows the header in either format.
      const offset = capture.length - width * height * 4
      let gray = 0
      let white = 0
      for (let y = Math.round(height * 0.08); y < Math.round(height * 0.92); y++) {
        const i = offset + (y * width + width - 3) * 4
        if (capture[i] > 250 && capture[i + 1] > 250 && capture[i + 2] > 250) white++
        if (capture[i] > 40 && capture[i] < 230 && Math.abs(capture[i] - capture[i + 1]) < 3 &&
          Math.abs(capture[i] - capture[i + 2]) < 3) gray++
      }
      assert.ok(white > height * 0.2, 'The test cover is visible without a native dialog covering the app')
      return gray
    }
    await expect.poll(nativeScrollbarPixels, { message: 'The underlying page has a visible native scrollbar' }).toBeGreaterThan(20)

    for (const scale of [100, 95, 125]) {
      await page.evaluate(async scale => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setUiScale', scale)
        await store.dispatch('showSettingsWindow')
      }, scale)
      await expect(page.locator('html')).toHaveClass(/appSettingsMaximized/)
      if (await page.locator('.settingsMenu').isVisible()) {
        await page.locator('.settingsMenu [data-section="appearance"]').click()
      }
      await expect(page.locator('.settingsContent > [data-section="appearance"]')).toBeVisible()
      const content = page.locator('.settingsContent')
      await content.evaluate(element => { element.scrollTop = 500 })
      await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await expect.poll(nativeScrollbarPixels, { message: `No duplicate native scrollbar over settings at ${scale}% scale` }).toBe(0)
      await expect(content.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-visible/)
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await expect.poll(nativeScrollbarPixels, { message: 'The native page scrollbar returns after closing settings' }).toBeGreaterThan(20)
    }
  } finally {
    await page.evaluate(async original => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('hideSettingsWindow')
      document.querySelector('#settings-scrollbar-test-spacer')?.remove()
      document.querySelector('#settings-scrollbar-test-cover')?.remove()
      for (const [key, value] of Object.entries(original?.settings ?? {})) store.commit('set' + key, value)
      scrollTo(0, original?.scrollTop ?? 0)
    }, original).catch(() => {})
    await browser.close()
  }
})
