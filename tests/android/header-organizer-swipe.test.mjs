import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { goTo } from '../../e2e/helpers/app.mjs'

// Install the current debug APK on a locked emulator, forward its WebView
// socket, and set ANDROID_CDP_URL to run these real touch regressions.
test('Android organizer pull follows the finger, settles into its card and preserves header controls', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  const session = await context.newCDPSession(page)
  // CDP may have no referenced handles while Android processes touch input.
  const keepAlive = setTimeout(() => {}, 240_000)
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
  const swipe = async (selector, distance, slow = false) => {
    const point = await pointFor(selector)
    await touch('touchStart', point)
    for (const fraction of [0.15, 0.4, 0.7, 1]) {
      await touch('touchMove', { ...point, x: point.x + distance * fraction })
      await page.waitForTimeout(slow ? 180 : 60)
    }
    await touch('touchEnd')
    await expect(page.locator('.pageSwipeFrom, .pageSwipeTo')).toHaveCount(0)
  }
  const presented = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPresentedTabId)
  try {
    await page.locator('.profileTrigger').waitFor()
    const skip = page.getByRole('button', { name: 'Skip', exact: true })
    if (await skip.isVisible()) await skip.click()
    await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
    saved = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = {
        CapacitorLayoutMode: 'phone', CurrentLocale: 'en-US', EnableMobileTabs: true,
        EnableDownloads: true, MoveDownloadsToAppHeader: true, MoveSettingsToAppHeader: true,
        AlwaysShowMobileSearchBar: false, ShowTabPreviews: true, UiScale: 100, ReducedMotion: 'off',
        NewTabPosition: 'afterCurrent', AnimationSpeed: 100,
        BaseTheme: 'system', SystemDarkTheme: 'dark', SystemLightTheme: 'light', MainColor: 'Red', SecColor: 'Blue',
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

    const dialog = page.locator('#capacitor-phone-tab-dialog')
    const movingPage = page.locator('.organizerSwipePage')
    // A new touch must select a card immediately after release, while the
    // page is still settling. Use real touch input: locator.click() waits for
    // inert overlays to become interactive and would hide this regression.
    for (const [speed, target] of [[25, first], [100, first], [100, second]]) {
      await page.evaluate(speed => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateAnimationSpeed', speed), speed)
      const start = await pointFor('.capacitorPhoneTabSwitcherButton')
      await touch('touchStart', start)
      for (let step = 1; step <= 8; step++) {
        await touch('touchMove', { ...start, y: start.y + step * 20 })
        await page.waitForTimeout(40)
      }
      await expect(movingPage).toHaveCount(1)
      const card = await pointFor(`.capacitorPhoneTabTarget[data-tab-id="${target}"] .capacitorPhoneTabTitle`)
      await touch('touchEnd')
      await touch('touchStart', card)
      await page.waitForTimeout(60)
      await touch('touchEnd')
      await expect.poll(presented, { message: `first tap after releasing a pull must select the card at ${speed}% speed` }).toBe(target)
      await expect(dialog).toHaveCount(0)
      await tap('.capacitorPhoneTabSwitcherButton')
      await page.locator(`.capacitorPhoneTabTarget[data-tab-id="${second}"]`).click()
      await expect(dialog).toHaveCount(0)
    }
    for (const [scale, motion] of [[100, 'off'], [125, 'off'], [125, 'on']]) {
      await page.evaluate(async ({ scale, motion }) => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateUiScale', scale)
        await store.dispatch('updateReducedMotion', motion)
      }, { scale, motion })
      for (const selector of ['.logo', '.navSearchButton', '.capacitorPhoneTabSwitcherButton', '.profileTrigger', '.settingsButton']) {
        if (!await page.locator(selector).isVisible()) continue
        const point = await pointFor(selector)
        await touch('touchStart', point)
        await touch('touchMove', { ...point, y: point.y + 45 })
        await expect(dialog).toBeVisible()
        await expect(page.locator('.capacitorPhoneTabOverlay')).toHaveClass(/organizerGesture/)
        if (motion === 'off') {
          await expect(movingPage).toHaveCount(1)
          const initial = await movingPage.boundingBox()
          await touch('touchMove', { ...point, y: point.y + 100 })
          const later = await movingPage.boundingBox()
          assert.ok(later.width < initial.width, 'the page must shrink as the finger moves')
        }
        // Full travel must land exactly on the current card, including a
        // fractional UI scale, before the finger releases.
        await touch('touchMove', { ...point, y: point.y + 320 })
        if (motion === 'off') {
          const from = await movingPage.boundingBox()
          const to = await page.locator(`.capacitorPhoneTabTarget[data-tab-id="${second}"] .capacitorTabPreview`).boundingBox()
          assert.ok(Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1 && Math.abs(from.width - to.width) < 1,
            `live page must meet its preview: ${JSON.stringify({ from, to })}`)
        }
        await touch('touchEnd')
        await expect(page.locator('.organizerGesture, .organizerSwipePage')).toHaveCount(0)
        await expect(dialog).toBeVisible()
        await expect.poll(presented).toBe(second)
        await expect(page.locator('.settingsWindow, .quickSettingsMenu')).toHaveCount(0)
        await expect(page.locator('.topNav .ft-input')).toBeHidden()
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(dialog).toHaveCount(0)
      }
    }
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', 100)
      await store.dispatch('updateReducedMotion', 'off')
    })
    for (const ending of ['short', 'reverse', 'cancel', 'resize']) {
      const point = await pointFor('.capacitorPhoneTabSwitcherButton')
      await touch('touchStart', point)
      await touch('touchMove', { ...point, y: point.y + (ending === 'reverse' ? 160 : 40) })
      await expect(movingPage).toHaveCount(1)
      if (ending === 'reverse') await touch('touchMove', { ...point, y: point.y + 5 })
      if (ending === 'resize') await page.evaluate(() => window.dispatchEvent(new Event('resize')))
      await page.waitForTimeout(400)
      await touch(ending === 'cancel' ? 'touchCancel' : 'touchEnd')
      await expect(dialog).toHaveCount(0)
      await expect(movingPage).toHaveCount(0)
      await expect.poll(presented).toBe(second)
    }
    // Opening the active card below a long list must scroll the organizer
    // before measuring the destination, without moving the underlying page.
    for (let index = 0; index < 5; index++) {
      await tap('.capacitorPhoneTabSwitcherButton')
      await dialog.getByRole('button', { name: 'New Tab', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    }
    const last = await presented()
    const point = await pointFor('.capacitorPhoneTabSwitcherButton')
    await touch('touchStart', point)
    await touch('touchMove', { ...point, y: point.y + 320 })
    await expect(movingPage).toHaveCount(1)
    const activePreview = page.locator(`.capacitorPhoneTabTarget[data-tab-id="${last}"] .capacitorTabPreview`)
    const from = await movingPage.boundingBox()
    const to = await activePreview.boundingBox()
    assert.ok(to.y > 0 && to.y + to.height <= await page.evaluate(() => innerHeight), 'active card must be in view')
    assert.ok(Math.abs(from.y - to.y) < 1 && Math.abs(from.x - to.x) < 1, 'scrolled card must remain the destination')
    await touch('touchEnd')
    await expect(movingPage).toHaveCount(0)
    await page.locator(`.capacitorPhoneTabTarget[data-tab-id="${second}"]`).click()
    await expect(dialog).toHaveCount(0)
    // Horizontal swipes and taps still work after repeated pull cancellation.
    await swipe('.capacitorPhoneTabSwitcherButton', 170)
    await expect.poll(presented).toBe(first)
    await tap('.navSearchButton')
    await expect(page.locator('.topNav .ft-input')).toBeFocused()
    await page.locator('.topNav .ft-input').fill('keep this draft')
    const inputPoint = await pointFor('.topNav .ft-input')
    await touch('touchStart', inputPoint)
    await touch('touchMove', { ...inputPoint, y: inputPoint.y + 180 })
    await touch('touchEnd')
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.topNav .ft-input')).toHaveValue('keep this draft')
    await tap('.closeMobileSearch')
    await tap('.capacitorPhoneTabSwitcherButton')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCapacitorLayoutMode', 'tablet'))
    const tabletPoint = await pointFor('.logo')
    await touch('touchStart', tabletPoint)
    await touch('touchMove', { ...tabletPoint, y: tabletPoint.y + 180 })
    await touch('touchEnd')
    await expect(dialog).toHaveCount(0)
  } finally {
    await touch('touchCancel').catch(() => {})
    const close = page.locator('#capacitor-phone-tab-dialog').getByRole('button', { name: 'Close', exact: true })
    if (await close.isVisible()) await close.click()
    if (saved) await page.evaluate(async saved => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(saved.settings)) await store.dispatch('update' + key, value)
      store.commit('setTabsState', saved.tabs)
      store.commit('setPresentedTab', saved.tabs.presentedTabId)
      location.hash = saved.route
    }, saved)
    await session.detach()
    await browser.close()
    clearTimeout(keepAlive)
  }
})

test('Android header keeps vertical panning when the phone organizer is unavailable', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const keepAlive = setTimeout(() => {}, 60_000)
  const saved = await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return { EnableMobileTabs: store.getters.getEnableMobileTabs, CapacitorLayoutMode: store.getters.getCapacitorLayoutMode }
  })
  try {
    for (const [layout, tabs, expected] of [
      ['phone', true, 'none'], ['phone', false, 'pan-y'],
      ['phone', true, 'none'], ['tablet', true, 'pan-y'],
    ]) {
      await page.evaluate(async ({ layout, tabs }) => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateCapacitorLayoutMode', layout)
        await store.dispatch('updateEnableMobileTabs', tabs)
      }, { layout, tabs })
      await expect(page.locator('.topNav'), `${layout} header with tabs ${tabs ? 'enabled' : 'disabled'}`)
        .toHaveCSS('touch-action', expected)
    }
  } finally {
    await page.evaluate(async saved => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(saved)) await store.dispatch('update' + key, value)
    }, saved)
    await browser.close()
    clearTimeout(keepAlive)
  }
})
