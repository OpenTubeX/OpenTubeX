import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'

// Run against a current debug APK on an exclusively locked emulator.
test('Android organizer button morphs into the active card and remains interactive during settlement', {
  skip: !process.env.ANDROID_CDP_URL,
}, async t => {
  // CDP can temporarily have no referenced Node handles while Android processes input.
  const keepAlive = setTimeout(() => {}, 120_000)
  t.after(() => clearTimeout(keepAlive))
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  t.after(() => browser.close())
  const page = browser.contexts()[0].pages()[0]
  const session = await browser.contexts()[0].newCDPSession(page)
  const touch = (type, point) => session.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] })
  const tap = async selector => {
    const box = await page.locator(selector).boundingBox()
    assert.ok(box, `${selector} must be visible before tapping`)
    await touch('touchStart', { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    // Model a real finger press; this is input duration, not a readiness wait.
    await page.waitForTimeout(60)
    await touch('touchEnd')
  }
  let saved
  try {
    saved = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = { CapacitorLayoutMode: 'phone', EnableMobileTabs: true, ReducedMotion: 'off', AnimationSpeed: 25 }
      const settings = Object.fromEntries(Object.keys(values).map(key => [key, store.getters['get' + key]]))
      for (const [key, value] of Object.entries(values)) await store.dispatch('update' + key, value)
      return settings
    })
    const moving = page.locator('.organizerSwipePage')
    const dialog = page.locator('#capacitor-phone-tab-dialog')
    await page.evaluate(() => {
      window.__organizerAnimationSamples = []
      const record = () => {
        const element = document.querySelector('.organizerSwipePage')
        if (element) window.__organizerAnimationSamples.push(new DOMMatrixReadOnly(getComputedStyle(element).transform).a)
        window.__organizerAnimationFrame = requestAnimationFrame(record)
      }
      window.__organizerAnimationFrame = requestAnimationFrame(record)
    })
    await tap('.capacitorPhoneTabSwitcherButton')
    await expect(dialog).toBeVisible()
    await expect(moving).toHaveCount(0)
    const samples = await page.evaluate(() => {
      cancelAnimationFrame(window.__organizerAnimationFrame)
      const samples = window.__organizerAnimationSamples
      delete window.__organizerAnimationFrame
      delete window.__organizerAnimationSamples
      return samples
    })
    assert.ok(samples.some((scale, index) => scale < 0.95 && scale > 0.5 && scale < samples[index - 1]),
      `tapping must paint intermediate shrinking frames: ${JSON.stringify(samples)}`)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    await tap('.capacitorPhoneTabSwitcherButton')
    await expect(moving).toHaveCount(1)
    await tap('.capacitorPhoneTabTarget[aria-selected="true"] .capacitorPhoneTabTitle')
    await expect(dialog).toHaveCount(0)
    await expect(moving).toHaveCount(0)
    await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')

    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateReducedMotion', 'on'))
    await tap('.capacitorPhoneTabSwitcherButton')
    await expect(dialog).toBeVisible()
    await expect(moving).toHaveCount(0)
    await expect(page.locator('.organizerGesture')).toHaveCount(0)
  } finally {
    await touch('touchCancel').catch(() => {})
    const close = page.locator('#capacitor-phone-tab-dialog').getByRole('button', { name: 'Close', exact: true })
    if (await close.isVisible()) await close.click()
    await page.evaluate(async saved => {
      cancelAnimationFrame(window.__organizerAnimationFrame)
      delete window.__organizerAnimationFrame
      delete window.__organizerAnimationSamples
      if (!saved) return
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(saved)) await store.dispatch('update' + key, value)
    }, saved)
  }
})
