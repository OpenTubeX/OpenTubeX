import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { goTo } from '../../e2e/helpers/app.mjs'

// Install the current debug APK on a locked emulator, forward its WebView
// socket, and set ANDROID_CDP_URL to run these real touch regressions.
test('Android header swipes include controls and preserve taps and long presses', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  const session = await context.newCDPSession(page)
  // CDP may have no referenced handles while Android processes touch input.
  const keepAlive = setTimeout(() => {}, 120_000)
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
  const selectTab = async id => {
    await tap('.capacitorPhoneTabSwitcherButton')
    await expect(page.locator('#capacitor-phone-tab-dialog')).toBeVisible()
    await page.locator(`.capacitorPhoneTabTarget[data-tab-id="${id}"]`).click()
    await expect(page.locator('#capacitor-phone-tab-dialog')).toHaveCount(0)
    await expect.poll(presented).toBe(id)
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
        EnableDownloads: true, MoveDownloadsToAppHeader: true, MoveSettingsToAppHeader: true,
        AlwaysShowMobileSearchBar: false, UiScale: 100, ReducedMotion: 'off',
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

    for (const [scale, reducedMotion] of [[100, 'off'], [125, 'off'], [125, 'on']]) {
      await page.evaluate(scale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', scale), scale)
      await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateReducedMotion', value), reducedMotion)
      for (const selector of ['.logo', '.navSearchButton', '.capacitorPhoneTabSwitcherButton', '.profileTrigger', '.downloadsButton', '.settingsButton', '.menuButton']) {
        if (!await page.locator(selector).isVisible()) continue
        await selectTab(first)
        const point = await pointFor(selector)
        const width = await page.evaluate(() => innerWidth)
        // Swipe toward the neighboring tab that has room for this control.
        if (point.x > width / 2) {
          await swipe(selector, -width * 0.4)
          await expect.poll(presented, { message: `left swipe on ${selector} at ${scale}%` }).toBe(second)
          await expect(page).toHaveURL(/#\/history/)
        } else {
          await selectTab(second)
          await swipe(selector, width * 0.4)
          await expect.poll(presented, { message: `right swipe on ${selector} at ${scale}%` }).toBe(first)
          await expect(page).toHaveURL(/#\/userplaylists/)
        }
        await expect(page.locator('#capacitor-phone-tab-dialog, .settingsWindow, .quickSettingsMenu')).toHaveCount(0)
        await expect(page.locator('.topNav .ft-input')).toBeHidden()
      }
    }
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', 100))
    await selectTab(first)
    await tap('.navSearchButton')
    const input = page.locator('.topNav .ft-input')
    await expect(input).toBeFocused()
    await input.fill('keep this draft')
    await swipe('.topNav .ft-input', -100)
    await expect.poll(presented).toBe(first)
    await expect(input).toHaveValue('keep this draft')
    await tap('.closeMobileSearch')
    await expect(input).toBeHidden()
    await tap('.settingsButton')
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('.settingsWindow')).toHaveCount(0)
    await tap('.profileTrigger')
    await expect(page.locator('.quickSettingsMenu')).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).click()
    await expect(page.locator('.quickSettingsMenu')).toHaveCount(0)
    // A deliberate drag that returns to its origin must cancel without a click.
    const point = await pointFor('.capacitorPhoneTabSwitcherButton')
    await touch('touchStart', point)
    await touch('touchMove', { ...point, x: point.x - 40 })
    await page.waitForTimeout(60)
    await touch('touchMove', point)
    await page.waitForTimeout(60)
    await touch('touchEnd')
    await expect(page.locator('.pageSwipeFrom, .pageSwipeTo, #capacitor-phone-tab-dialog')).toHaveCount(0)
    await expect.poll(presented).toBe(first)
    await tap('.capacitorPhoneTabSwitcherButton')
    await expect(page.locator('#capacitor-phone-tab-dialog')).toBeVisible()
    await page.locator('#capacitor-phone-tab-dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('#capacitor-phone-tab-dialog')).toHaveCount(0)

    // Browser cancellation produces no click; it must not affect the next tap.
    await touch('touchStart', point)
    await touch('touchMove', { ...point, x: point.x - 40 })
    await page.waitForTimeout(60)
    await touch('touchCancel')
    await expect(page.locator('.pageSwipeFrom, .pageSwipeTo')).toHaveCount(0)
    await expect.poll(presented).toBe(first)
    await tap('.capacitorPhoneTabSwitcherButton')
    await expect(page.locator('#capacitor-phone-tab-dialog')).toBeVisible()
    await page.locator('#capacitor-phone-tab-dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('#capacitor-phone-tab-dialog')).toHaveCount(0)

    // Change tabs without starting another pointer, keeping this drag alive.
    const selectTabDuringDrag = async id => {
      await page.locator('.capacitorPhoneTabSwitcherButton').evaluate(button => button.click())
      await expect(page.locator('#capacitor-phone-tab-dialog')).toBeVisible()
      await page.locator(`.capacitorPhoneTabTarget[data-tab-id="${id}"]`).evaluate(button => button.click())
      await expect(page.locator('#capacitor-phone-tab-dialog')).toHaveCount(0)
      await expect.poll(presented).toBe(id)
    }
    const interruptedPoint = await pointFor('.profileTrigger')
    await touch('touchStart', interruptedPoint)
    await touch('touchMove', { ...interruptedPoint, x: interruptedPoint.x - 40 })
    await page.waitForTimeout(60)
    await expect(page.locator('.pageSwipeTo')).toBeVisible()
    await selectTabDuringDrag(second)
    await touch('touchMove', { ...interruptedPoint, x: interruptedPoint.x - 60 })
    await expect(page.locator('.pageSwipeFrom, .pageSwipeTo')).toHaveCount(0)
    await selectTabDuringDrag(first)
    await touch('touchMove', { ...interruptedPoint, x: interruptedPoint.x - 80 })
    await expect(page.locator('.pageSwipeFrom, .pageSwipeTo')).toHaveCount(0)
    await touch('touchEnd')
    await expect(page.locator('.quickSettingsMenu')).toHaveCount(0)
    await expect.poll(presented).toBe(first)
    await tap('.profileTrigger')
    await expect(page.locator('.quickSettingsMenu')).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).click()
    await expect(page.locator('.quickSettingsMenu')).toHaveCount(0)

    await touch('touchStart', interruptedPoint)
    await touch('touchMove', { ...interruptedPoint, x: interruptedPoint.x - 40 })
    await page.waitForTimeout(60)
    await expect(page.locator('.pageSwipeTo')).toBeVisible()
    await page.locator('.capacitorPhoneTabSwitcherButton').evaluate(button => button.click())
    await expect(page.locator('#capacitor-phone-tab-dialog')).toBeVisible()
    await touch('touchMove', { ...interruptedPoint, x: interruptedPoint.x - 60 })
    await expect(page.locator('.pageSwipeFrom, .pageSwipeTo')).toHaveCount(0)
    await touch('touchEnd')
    await expect(page.locator('#capacitor-phone-tab-dialog')).toBeVisible()
    await expect(page.locator('.quickSettingsMenu')).toHaveCount(0)
    await page.locator('#capacitor-phone-tab-dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('#capacitor-phone-tab-dialog')).toHaveCount(0)
    await tap('.profileTrigger')
    await expect(page.locator('.quickSettingsMenu')).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).click()
    await expect(page.locator('.quickSettingsMenu')).toHaveCount(0)

    // Tablet navigation has a long-press history menu; swiping must cancel its timer.
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCapacitorLayoutMode', 'tablet'))
    await goTo(page, 'history')
    await expect(page.locator('.navBackButton')).toBeVisible()
    await swipe('.navBackButton', 180, true)
    await expect(page.locator('.navBackButton .iconDropdown')).toHaveCount(0)
    await goTo(page, 'history')
    await expect(page.locator('.navBackButton .iconButton')).toHaveAttribute('aria-disabled', 'false')
    await touch('touchStart', await pointFor('.navBackButton'))
    await page.waitForTimeout(600)
    await touch('touchEnd')
    await expect(page.locator('.navBackButton .iconDropdown')).toBeVisible()
    await expect(page).toHaveURL(/#\/history/)
    await page.locator('.navBackButton .iconDropdown').focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('.navBackButton .iconDropdown')).toHaveCount(0)
    await tap('.navBackButton .iconButton')
    await expect(page).toHaveURL(/#\/userplaylists/)
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
