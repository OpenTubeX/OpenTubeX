import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { goTo } from '../../e2e/helpers/app.mjs'

// Install the current debug APK on a locked emulator, forward its WebView
// socket, and set ANDROID_CDP_URL to run these real touch regressions.
test('Android header swipes reveal the next tab at its own scroll position', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  const session = await context.newCDPSession(page)
  // CDP may have no referenced handles while Android processes touch input.
  const keepAlive = setInterval(() => {}, 1_000)
  let saved
  const touch = (type, point) => session.send('Input.dispatchTouchEvent', {
    type, touchPoints: point ? [point] : [],
  })
  const pointFor = async selector => {
    const box = await page.locator(selector).boundingBox()
    assert.ok(box, `${selector} must be visible`)
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const tap = async selector => {
    await touch('touchStart', await pointFor(selector))
    // Give Chromium a real tap duration rather than back-to-back CDP events.
    await page.waitForTimeout(60)
    await touch('touchEnd')
  }
  const presented = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPresentedTabId)
  const selectTab = async id => {
    await tap('.capacitorPhoneTabSwitcherButton')
    await expect(page.locator('#capacitor-phone-tab-dialog')).toBeVisible()
    await page.locator(`.capacitorPhoneTabTarget[data-tab-id="${id}"]`).click()
    await expect(page.locator('#capacitor-phone-tab-dialog')).toHaveCount(0)
    await expect.poll(presented).toBe(id)
  }
  const scrollTo = async top => {
    await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), top)
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(top)
  }
  try {
    await page.locator('.profileTrigger').waitFor()
    const skip = page.getByRole('button', { name: 'Skip', exact: true })
    if (await skip.isVisible()) await skip.click()
    await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
    saved = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        CapacitorLayoutMode: 'phone', CurrentLocale: 'en-US', EnableMobileTabs: true,
        UiScale: 100, ReducedMotion: 'off', NewTabPosition: 'afterCurrent',
      }
      const settings = Object.fromEntries(Object.keys(values).map(key => [key, store.getters['get' + key]]))
      const tabs = JSON.parse(JSON.stringify(store.state.tabs))
      const route = location.hash
      for (const [key, value] of Object.entries(values)) await store.dispatch('update' + key, value)
      return { settings, tabs, route }
    })
    if (await page.locator('#capacitor-phone-tab-dialog').count()) {
      await page.locator('#capacitor-phone-tab-dialog').getByRole('button', { name: 'Close', exact: true }).click()
      await expect(page.locator('#capacitor-phone-tab-dialog')).toHaveCount(0)
    }
    await goTo(page, 'userplaylists')
    const first = await presented()
    await tap('.capacitorPhoneTabSwitcherButton')
    await page.getByRole('button', { name: 'New Tab', exact: true }).click()
    await expect(page.locator('#capacitor-phone-tab-dialog')).toHaveCount(0)
    await goTo(page, 'history')
    const second = await presented()
    assert.notEqual(first, second)
    // Give both pages enough height for independent scroll positions.
    await page.evaluate(ids => {
      for (const id of ids) {
        const spacer = document.createElement('div')
        spacer.className = 'swipeScrollSpacer'
        spacer.style.blockSize = '4000px'
        document.querySelector(`.tabContent[data-tab-id="${id}"]`).append(spacer)
      }
    }, [first, second])

    for (const scale of [100, 125]) {
      await page.evaluate(scale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', scale), scale)
      for (const [fromTop, toTop] of [[1500, 0], [0, 800], [1500, 600]]) {
        const message = `${fromTop}px to ${toTop}px at ${scale}%`
        await selectTab(second)
        await scrollTo(toTop)
        await selectTab(first)
        await scrollTo(fromTop)

        // Sample the incoming page on every frame from the drag through settling.
        await page.evaluate(id => {
          const samples = window.headerSwipeScrollSamples = []
          const record = () => {
            const target = document.querySelector(`.tabContent[data-tab-id="${id}"]`)
            if (target && (target.classList.contains('pageSwipeTo') || samples.length)) {
              samples.push(target.getBoundingClientRect().top)
            }
            if (window.headerSwipeScrollSamples === samples) requestAnimationFrame(record)
          }
          requestAnimationFrame(record)
        }, second)
        const point = await pointFor('.profileTrigger')
        const width = await page.evaluate(() => document.querySelector('.app > .routerView').getBoundingClientRect().width)
        await touch('touchStart', point)
        // Paint each drag position before the next move so it is sampled.
        for (const fraction of [0.15, 0.4, 0.7]) {
          await touch('touchMove', { ...point, x: point.x - width * fraction })
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        }
        await expect(page.locator('.pageSwipeTo')).toBeVisible()
        await touch('touchEnd')
        await expect(page.locator('.pageSwipeFrom, .pageSwipeTo')).toHaveCount(0)
        await expect.poll(presented, { message }).toBe(second)
        // Keep sampling for several frames after the tab settles.
        const settledFrames = await page.evaluate(() => window.headerSwipeScrollSamples.length) + 10
        await expect.poll(() => page.evaluate(() => window.headerSwipeScrollSamples.length)).toBeGreaterThanOrEqual(settledFrames)
        const samples = await page.evaluate(() => {
          const samples = window.headerSwipeScrollSamples
          delete window.headerSwipeScrollSamples
          return samples
        })
        assert.equal(Math.round(await page.evaluate(() => window.scrollY)), toTop, message)
        assert.ok(samples.length > 10, `${message}: the gesture must be sampled`)
        const settledTop = samples.at(-1)
        const jumps = samples.filter(top => Math.abs(top - settledTop) > 1)
        assert.deepEqual(jumps, [], `${message}: the incoming page must not jump (settled at ${settledTop}px)`)
      }
    }
  } finally {
    await touch('touchCancel').catch(() => {})
    const close = page.locator('#capacitor-phone-tab-dialog').getByRole('button', { name: 'Close', exact: true })
    if (await close.isVisible().catch(() => false)) await close.click()
    if (saved) await page.evaluate(async saved => {
      delete window.headerSwipeScrollSamples
      for (const spacer of document.querySelectorAll('.swipeScrollSpacer')) spacer.remove()
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(saved.settings)) await store.dispatch('update' + key, value)
      store.commit('setTabsState', saved.tabs)
      store.commit('setPresentedTab', saved.tabs.presentedTabId)
      location.hash = saved.route
    }, saved)
    clearInterval(keepAlive)
    await session.detach()
    await browser.close()
  }
})
