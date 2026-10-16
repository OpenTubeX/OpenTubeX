import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'

// Run against a current debug APK on an exclusively locked emulator.
test('Android organizer keeps the live crop aligned when page content changes during a pull', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  // CDP can temporarily have no referenced Node handles while Android processes input.
  const keepAlive = setTimeout(() => {}, 120_000)
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const session = await browser.contexts()[0].newCDPSession(page)
  const touch = (type, point) => session.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] })
  let saved
  try {
    saved = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = { CapacitorLayoutMode: 'phone', EnableMobileTabs: true, ReducedMotion: 'off', UiScale: 100 }
      const settings = Object.fromEntries(Object.keys(values).map(key => [key, store.getters['get' + key]]))
      for (const [key, value] of Object.entries(values)) await store.dispatch('update' + key, value)
      return { settings, scroll: scrollY }
    })
    for (const scale of [100, 125]) {
      await page.evaluate(async scale => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateUiScale', scale)
        const fixture = document.createElement('div')
        fixture.id = 'organizer-live-crop-fixture'
        fixture.style.cssText = 'height:2400px;background:linear-gradient(#f60,#0080ff)'
        document.querySelector('.app > .routerView').prepend(fixture)
        window.scrollTo(0, 400)
      }, scale)
      await expect.poll(() => page.evaluate(scale => {
        const expectedWidth = Math.round(window.outerWidth * 100 / scale)
        return Math.abs(window.innerWidth - expectedWidth)
      }, scale), { message: `wait for the ${scale}% layout viewport before starting the pull` }).toBeLessThanOrEqual(1)
      const box = await page.locator('.capacitorPhoneTabSwitcherButton').boundingBox()
      assert.ok(box, 'the tab organizer button must be visible before pulling')
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await touch('touchStart', point)
      await touch('touchMove', { ...point, y: point.y + 80 })
      await expect(page.locator('.organizerSwipePage')).toHaveCount(1)
      // Loading or removing feed rows below the captured region must not
      // change the crop. Keep the visible content and scroll offset intact.
      for (const height of [2200, 2600]) {
        await page.evaluate(height => { document.querySelector('#organizer-live-crop-fixture').style.height = `${height}px` }, height)
        await touch('touchMove', { ...point, y: point.y + 320 })
        const geometry = await page.evaluate(() => {
          const element = document.querySelector('.organizerSwipePage')
          const bounds = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          const inset = style.clipPath.match(/inset\(([-\d.]+)px 0px (?:calc\(100% - ([-\d.]+)px\)|([-\d.]+)px)/)
          const scale = new DOMMatrixReadOnly(style.transform).a
          const target = document.querySelector('.capacitorPhoneTabTarget[aria-selected="true"] .capacitorTabPreview').getBoundingClientRect()
          return { top: bounds.top + Number(inset[1]) * scale, bottom: inset[2] === undefined ? bounds.bottom - Number(inset[3]) * scale : bounds.top + Number(inset[2]) * scale,
            targetTop: target.top, targetBottom: target.bottom }
        })
        assert.ok(Math.abs(geometry.top - geometry.targetTop) < 1 && Math.abs(geometry.bottom - geometry.targetBottom) < 1,
          `the live page must fill its card before release at ${scale}%: ${JSON.stringify(geometry)}`)
        await touch('touchMove', { ...point, y: point.y + 80 })
      }
      await touch('touchMove', { ...point, y: point.y + 320 })
      await touch('touchEnd')
      await expect(page.locator('.organizerSwipePage')).toHaveCount(0)
      await page.locator('#capacitor-phone-tab-dialog').getByRole('button', { name: 'Close', exact: true }).click()
      await page.evaluate(() => document.querySelector('#organizer-live-crop-fixture').remove())
    }
  } finally {
    await touch('touchCancel').catch(() => {})
    const close = page.locator('#capacitor-phone-tab-dialog').getByRole('button', { name: 'Close', exact: true })
    if (await close.isVisible()) await close.click()
    await page.evaluate(async saved => {
      document.querySelector('#organizer-live-crop-fixture')?.remove()
      if (!saved) return
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(saved.settings)) await store.dispatch('update' + key, value)
      window.scrollTo(0, saved.scroll)
    }, saved)
    await session.detach()
    await browser.close()
    clearTimeout(keepAlive)
  }
})

test('Android organizer button morphs into the active card and remains interactive during settlement', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  // CDP can temporarily have no referenced Node handles while Android processes input.
  const keepAlive = setTimeout(() => {}, 120_000)
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
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
    await session.detach()
    await browser.close()
    clearTimeout(keepAlive)
  }
})
