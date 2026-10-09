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
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setTabsState', { ...store.state.tabs, tabs: [store.getters.getPresentedTab] })
    })
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
    // Capture a known page region, then scroll before the automatic preview
    // refresh. The pull must refresh the cached image and morph only the region
    // below the fixed header, including at fractional layout scales.
    for (const scale of [100, 125]) {
      await page.evaluate(async scale => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateUiScale', scale)
        const fixture = document.createElement('div')
        fixture.id = 'organizer-scroll-fixture'
        fixture.style.cssText = 'height:2400px;background:linear-gradient(#f60 0 700px,#0080ff 700px 100%);'
        document.querySelector('.app > .routerView').prepend(fixture)
        window.scrollTo(0, 0)
      }, scale)
      try {
        await tap('.capacitorPhoneTabSwitcherButton')
        const thumbnail = page.locator(`.capacitorPhoneTabTarget[data-tab-id="${second}"] img.capacitorTabThumbnail`)
        await expect(thumbnail).toBeVisible()
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(dialog).toHaveCount(0)
        const initial = await page.evaluate(() => {
          window.scrollTo(0, 900.5)
          const page = document.querySelector('.app > .routerView').getBoundingClientRect()
          return { scroll: window.scrollY, top: page.top, width: page.width,
            header: document.querySelector('.topNav').getBoundingClientRect().bottom }
        })
        assert.ok(initial.top < 0)
        const start = await pointFor('.capacitorPhoneTabSwitcherButton')
        await touch('touchStart', start)
        await touch('touchMove', { ...start, y: start.y + 45 })
        await expect(movingPage).toHaveCount(1)
        await expect(thumbnail).toBeAttached()
        await expect(thumbnail).toBeHidden()
        const color = await thumbnail.evaluate(async image => {
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 1
          const context = canvas.getContext('2d')
          context.drawImage(image, 0, 0, 1, 1)
          return [...context.getImageData(0, 0, 1, 1).data]
        })
        assert.ok(color[2] > 200 && color[0] < 40, `preview must refresh to the visible blue region: ${color}`)
        const aspect = await thumbnail.evaluate(image => {
          const preview = image.closest('.capacitorTabPreview').getBoundingClientRect()
          return { image: image.naturalWidth / image.naturalHeight, card: preview.width / preview.height }
        })
        assert.ok(Math.abs(aspect.card - 16 / 9) < 0.01, 'phone previews must retain their compact landscape dimensions')
        assert.ok(Math.abs(aspect.image - aspect.card) < 0.01, 'the preview must preserve the captured viewport without cropping')
        const clipTop = await movingPage.evaluate(element => Number.parseFloat(getComputedStyle(element).clipPath.slice(6)))
        assert.ok(Math.abs(clipTop - (initial.header - initial.top)) < 1, 'hidden page content must stay clipped throughout the drag')
        await touch('touchMove', { ...start, y: start.y + 320 })
        const geometry = await movingPage.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          const top = Number.parseFloat(style.clipPath.slice(6))
          const bottom = Number.parseFloat(style.clipPath.split(' ')[2])
          const scale = new DOMMatrixReadOnly(style.transform).a
          return { left: bounds.left, top: bounds.top + top * scale, width: bounds.width,
            height: bounds.height - (top + bottom) * scale }
        })
        const preview = await thumbnail.boundingBox()
        assert.ok(Math.abs(geometry.left - preview.x) < 1 && Math.abs(geometry.top - preview.y) < 1 &&
          Math.abs(geometry.width - preview.width) < 1 && Math.abs(geometry.height - preview.height) < 1,
          'the visible crop must land in its card')
        const corners = await movingPage.evaluate(element => {
          const style = getComputedStyle(element)
          return { radius: Number.parseFloat(style.clipPath.split('round ')[1]), scale: new DOMMatrixReadOnly(style.transform).a }
        })
        const targetRadius = await thumbnail.evaluate(image => Number.parseFloat(getComputedStyle(image.closest('.capacitorPhoneTabTarget')).borderTopLeftRadius))
        assert.ok(Math.abs(corners.radius * corners.scale - targetRadius) < 1, 'the live page must meet the rounded preview corners')
        await touch('touchEnd')
        await expect(movingPage).toHaveCount(0)
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        assert.equal(await page.evaluate(() => window.scrollY), initial.scroll, 'returning to the page preserves its viewport')
      } finally {
        await touch('touchCancel').catch(() => {})
        if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Close', exact: true }).click({ timeout: 1000 }).catch(() => {})
        await page.evaluate(() => { document.querySelector('#organizer-scroll-fixture')?.remove(); window.scrollTo(0, 0) })
      }
    }
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', 100))
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
      await expect(page.locator('.capacitorPhoneTabOverlay')).not.toHaveClass(/organizerGesture/)
      await touch('touchStart', card)
      await page.waitForTimeout(60)
      await touch('touchEnd')
      await expect.poll(presented, { message: `first tap after releasing a pull must select the card at ${speed}% speed` }).toBe(target)
      await expect(dialog).toHaveCount(0)
      await expect(page.locator('dialog.mobileSheet[open]')).toHaveCount(0)
      await page.locator('.capacitorPhoneTabSwitcherButton').click()
      await expect(dialog).toBeVisible()
      await page.locator(`.capacitorPhoneTabTarget[data-tab-id="${second}"]`).click()
      await expect(dialog).toHaveCount(0)
      await expect.poll(presented).toBe(second)
      await expect(page.locator('.organizerSwipePage, .capacitorPhoneTabOverlay')).toHaveCount(0)
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
    // Keep the active card below the viewport even in the compact two-column grid.
    for (let index = 0; index < 10; index++) {
      await tap('.capacitorPhoneTabSwitcherButton')
      await dialog.getByRole('button', { name: 'New Tab', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    }
    const last = await presented()
    // A cancelled pull must not replace the organizer viewport the user left
    // with the temporary offset used to bring the active card into view.
    const organizerScroll = page.locator('#capacitor-phone-open-tabs-panel')
    for (const ending of ['short', 'reverse', 'cancel', 'resize']) {
      await tap('.capacitorPhoneTabSwitcherButton')
      await expect(dialog).toBeVisible()
      await organizerScroll.evaluate(element => { element.scrollTop = 123 })
      const savedScroll = await organizerScroll.evaluate(element => element.scrollTop)
      assert.ok(savedScroll > 0)
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      const start = await pointFor('.capacitorPhoneTabSwitcherButton')
      await touch('touchStart', start)
      await touch('touchMove', { ...start, y: start.y + (ending === 'reverse' ? 160 : 40) })
      await expect(movingPage).toHaveCount(1)
      assert.ok(await organizerScroll.evaluate(element => element.scrollTop) > savedScroll + 100,
        'the active card must require a temporary viewport adjustment')
      if (ending === 'reverse') await touch('touchMove', { ...start, y: start.y + 5 })
      if (ending === 'resize') await page.evaluate(() => window.dispatchEvent(new Event('resize')))
      await page.waitForTimeout(400)
      await touch(ending === 'cancel' ? 'touchCancel' : 'touchEnd')
      await expect(dialog).toHaveCount(0)
      await tap('.capacitorPhoneTabSwitcherButton')
      await expect(dialog).toBeVisible()
      await expect.poll(async () => Math.abs(await organizerScroll.evaluate(element => element.scrollTop) - savedScroll),
        { message: `${ending} must preserve the saved organizer viewport` }).toBeLessThan(1)
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    }
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
    try {
      try {
        await touch('touchCancel').catch(() => {})
        const close = page.locator('#capacitor-phone-tab-dialog').getByRole('button', { name: 'Close', exact: true })
        if (await close.isVisible()) await close.click()
      } finally {
        if (saved) {
          const errors = []
          for (const [key, value] of Object.entries(saved.settings)) {
            await page.evaluate(({ key, value }) => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('update' + key, value), { key, value })
              .catch(error => { errors.push(new Error(`Could not restore ${key}`, { cause: error })) })
          }
          await page.evaluate(saved => {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
            store.commit('setTabsState', saved.tabs)
            store.commit('setPresentedTab', saved.tabs.presentedTabId)
            location.hash = saved.route
          }, saved).catch(error => { errors.push(new Error('Could not restore tabs and route', { cause: error })) })
          if (errors.length) throw new AggregateError(errors, 'Could not fully restore Android test state')
        }
      }
    } finally {
      clearTimeout(keepAlive)
      await session.detach().catch(() => {})
      await browser.close()
    }
  }
})

test('Android header preserves native upward panning alongside organizer gestures', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const session = await browser.contexts()[0].newCDPSession(page)
  const touch = (type, point) => session.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] })
  const originalScroll = await page.evaluate(() => window.scrollY)
  const keepAlive = setTimeout(() => {}, 60_000)
  const saved = await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return { EnableMobileTabs: store.getters.getEnableMobileTabs, CapacitorLayoutMode: store.getters.getCapacitorLayoutMode }
  })
  try {
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateCapacitorLayoutMode', 'phone'))
    await page.locator('.app > .routerView').waitFor()
    await page.evaluate(() => {
      const fixture = document.createElement('div')
      fixture.id = 'header-pan-fixture'
      fixture.style.height = '2400px'
      document.querySelector('.app > .routerView').prepend(fixture)
    })
    for (const [layout, tabs, expected] of [
      ['phone', true, 'pan-down'], ['phone', false, 'pan-y'],
      ['phone', true, 'pan-down'], ['tablet', true, 'pan-y'],
    ]) {
      await page.evaluate(async ({ layout, tabs }) => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateCapacitorLayoutMode', layout)
        await store.dispatch('updateEnableMobileTabs', tabs)
      }, { layout, tabs })
      await expect(page.locator('.topNav'), `${layout} header with tabs ${tabs ? 'enabled' : 'disabled'}`)
        .toHaveCSS('touch-action', expected)
      if (layout === 'phone') {
        await page.evaluate(() => window.scrollTo(0, 400))
        const initial = await page.evaluate(() => window.scrollY)
        const box = await page.locator('.topNav').boundingBox()
        const point = { x: box.x + box.width / 2, y: box.y + box.height - 4 }
        await touch('touchStart', point)
        for (let step = 1; step <= 8; step++) {
          await touch('touchMove', { ...point, y: point.y - Math.min(48, point.y - 2) * step / 8 })
          await page.waitForTimeout(30)
        }
        await touch('touchEnd')
        await expect.poll(() => page.evaluate(() => window.scrollY),
          { message: `an upward header drag must scroll with mobile tabs ${tabs ? 'enabled' : 'disabled'}` }).toBeGreaterThan(initial + 5)
        await expect(page.locator('#capacitor-phone-tab-dialog')).toHaveCount(0)
      }
    }
  } finally {
    await touch('touchCancel').catch(() => {})
    await page.evaluate(scroll => { document.querySelector('#header-pan-fixture')?.remove(); window.scrollTo(0, scroll) }, originalScroll)
    await page.evaluate(async saved => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(saved)) await store.dispatch('update' + key, value)
    }, saved)
    await session.detach()
    await browser.close()
    clearTimeout(keepAlive)
  }
})

test('Android organizer unmount releases its modal lock during committed settlement', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const session = await browser.contexts()[0].newCDPSession(page)
  const keepAlive = setTimeout(() => {}, 60_000)
  const saved = await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const values = { CapacitorLayoutMode: 'phone', EnableMobileTabs: true, ReducedMotion: 'off', AnimationSpeed: 25 }
    const settings = Object.fromEntries(Object.keys(values).map(key => [key, store.getters['get' + key]]))
    for (const [key, value] of Object.entries(values)) await store.dispatch('update' + key, value)
    return { settings, overflow: document.documentElement.style.overflow }
  })
  const touch = (type, point) => session.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] })
  try {
    const box = await page.locator('.capacitorPhoneTabSwitcherButton').boundingBox()
    assert.ok(box)
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await touch('touchStart', point)
    for (let step = 1; step <= 8; step++) {
      await touch('touchMove', { ...point, y: point.y + step * 20 })
      await page.waitForTimeout(40)
    }
    await touch('touchEnd')
    await expect(page.locator('.organizerGesture')).toHaveCount(0)
    await expect(page.locator('html')).toHaveCSS('overflow', 'hidden')
    // Unmount synchronously while settlement is active, without first changing
    // props and giving the modal watcher a chance to release the lock.
    const teardown = await page.evaluate(() => {
      if (!document.querySelector('.organizerSwipePage')) throw new Error('the committed gesture must still be settling')
      const app = document.querySelector('#app').__vue_app__
      const store = app.config.globalProperties.$store
      app.unmount()
      return { overflow: document.documentElement.style.overflow, promptOpen: store.getters.isAnyPromptOpen }
    })
    assert.equal(teardown.overflow, saved.overflow, 'unmount must release the root scroll lock')
    assert.equal(teardown.promptOpen, false, 'unmount must remove the organizer prompt')
  } finally {
    await touch('touchCancel').catch(() => {})
    await page.reload()
    await page.locator('.profileTrigger').waitFor()
    await page.evaluate(async saved => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(saved.settings)) await store.dispatch('update' + key, value)
    }, saved)
    await session.detach()
    await browser.close()
    clearTimeout(keepAlive)
  }
})

test('Android pointer cancellation cannot reopen an organizer waiting for capture', {
  skip: !process.env.ANDROID_CDP_URL,
}, async () => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const session = await browser.contexts()[0].newCDPSession(page)
  const keepAlive = setTimeout(() => {}, 60_000)
  const saved = await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const values = { CapacitorLayoutMode: 'phone', EnableMobileTabs: true, ShowTabPreviews: true, ReducedMotion: 'off' }
    const settings = Object.fromEntries(Object.keys(values).map(key => [key, store.getters['get' + key]]))
    for (const [key, value] of Object.entries(values)) await store.dispatch('update' + key, value)
    const state = { nativePromise: window.Capacitor.nativePromise, pointer: null, cancelled: false, opened: false }
    window.__organizerPendingCaptureTest = state
    state.onPointerDown = event => { state.pointer = event }
    document.addEventListener('pointerdown', state.onPointerDown, true)
    window.Capacitor.nativePromise = function (plugin, method, ...args) {
      if (plugin === 'Screenshot' && method === 'take' && state.pointer) {
        // Cancel in the capture task rather than a later CDP round trip, which
        // can exceed the 250ms capture timeout on a busy emulator.
        return new Promise(resolve => queueMicrotask(() => {
          state.pointer.target.dispatchEvent(new PointerEvent('pointercancel', {
            bubbles: true, pointerId: state.pointer.pointerId, pointerType: 'touch',
          }))
          state.cancelled = true
          resolve({})
        }))
      }
      return state.nativePromise.call(this, plugin, method, ...args)
    }
    state.observer = new MutationObserver(() => {
      if (document.querySelector('#capacitor-phone-tab-dialog')) state.opened = true
    })
    state.observer.observe(document.body, { childList: true, subtree: true })
    return settings
  })
  const touch = (type, point) => session.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] })
  try {
    const box = await page.locator('.capacitorPhoneTabSwitcherButton').boundingBox()
    assert.ok(box)
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await touch('touchStart', point)
    await touch('touchMove', { ...point, y: point.y + 80 })
    await page.waitForTimeout(500)
    assert.equal(await page.evaluate(() => window.__organizerPendingCaptureTest.cancelled), true,
      'the gesture must be cancelled while native capture is pending')
    assert.equal(await page.evaluate(() => window.__organizerPendingCaptureTest.opened), false,
      'a late native result must never show the cancelled organizer')
    await expect(page.locator('#capacitor-phone-tab-dialog, .organizerSwipePage')).toHaveCount(0)
  } finally {
    await touch('touchCancel').catch(() => {})
    await page.evaluate(async saved => {
      const state = window.__organizerPendingCaptureTest
      state.observer.disconnect()
      document.removeEventListener('pointerdown', state.onPointerDown, true)
      window.Capacitor.nativePromise = state.nativePromise
      delete window.__organizerPendingCaptureTest
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (const [key, value] of Object.entries(saved)) await store.dispatch('update' + key, value)
    }, saved)
    await session.detach()
    await browser.close()
    clearTimeout(keepAlive)
  }
})

// Run on a wide emulator viewport (for example, Android landscape at >680 CSS px).
test('Android wide phone layout captures compact previews with vertical navigation', {
  skip: !process.env.ANDROID_CDP_URL,
}, async t => {
  const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  const page = browser.contexts()[0].pages()[0]
  const keepAlive = setTimeout(() => {}, 60_000)
  let saved
  try {
    if (await page.evaluate(() => innerWidth) <= 680) {
      t.skip('Requires a viewport wider than 680 CSS pixels')
      return
    }
    saved = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const values = { CapacitorLayoutMode: 'phone', CurrentLocale: 'en-US', EnableMobileTabs: true,
        ShowTabPreviews: true, UiScale: 100 }
      const settings = Object.fromEntries(Object.keys(values).map(key => [key, store.getters['get' + key]]))
      const tabs = JSON.parse(JSON.stringify(store.state.tabs))
      for (const [key, value] of Object.entries(values)) await store.dispatch('update' + key, value)
      store.commit('setTabsState', { ...store.state.tabs, tabs: [store.getters.getPresentedTab] })
      return { settings, tabs }
    })
    const navigation = await page.locator('.app.capacitorPhoneLayout > .sideNav').boundingBox()
    assert.ok(navigation?.width > 0 && navigation.width < await page.evaluate(() => innerWidth) / 2,
      'the fixture must use vertical side navigation')
    await page.locator('.capacitorPhoneTabSwitcherButton').click()
    const dialog = page.locator('#capacitor-phone-tab-dialog')
    const thumbnail = dialog.locator('.capacitorTabPageThumbnail')
    await expect(thumbnail).toBeVisible()
    const image = await thumbnail.evaluate(async image => {
      await image.decode()
      return { width: image.naturalWidth, height: image.naturalHeight }
    })
    assert.ok(image.width > 0 && image.height > 0)
    const preview = await dialog.locator('.capacitorTabPreview').boundingBox()
    assert.ok(preview, 'the compact preview must have visible bounds')
    assert.ok(Math.abs(preview.width / preview.height - 16 / 9) < 0.01,
      'wide phone previews must keep their compact landscape dimensions')
    await t.test('short landscape page crossfades into its compact preview', {
      skip: image.width / image.height <= 16 / 9 + 0.01,
    }, async () => {
      // A short landscape capture cannot fill its card at the live page's
      // width scale. Crossfade instead of hiding the cached image.
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      const button = await page.locator('.capacitorPhoneTabSwitcherButton').boundingBox()
      assert.ok(button)
      const session = await browser.contexts()[0].newCDPSession(page)
      const point = { x: button.x + button.width / 2, y: button.y + button.height / 2 }
      const touch = (type, y) => session.send('Input.dispatchTouchEvent', {
        type, touchPoints: y == null ? [] : [{ x: point.x, y }],
      })
      try {
        await touch('touchStart', point.y)
        await touch('touchMove', point.y + 45)
        const moving = page.locator('.organizerSwipePage')
        await expect(moving).toHaveCount(1)
        await expect(thumbnail).toBeAttached()
        await expect(thumbnail).toBeVisible()
        await touch('touchMove', point.y + Math.min(320, await page.evaluate(() => innerHeight * 0.45)))
        await expect.poll(() => moving.evaluate(element => getComputedStyle(element).opacity)).toBe('0')
        await expect(thumbnail).toBeVisible()
        await touch('touchEnd')
        await expect(moving).toHaveCount(0)
        await expect(thumbnail).toBeVisible()
      } finally {
        await touch('touchCancel').catch(() => {})
        await session.detach()
      }
    })
  } finally {
    clearTimeout(keepAlive)
    try {
      try {
        const close = page.locator('#capacitor-phone-tab-dialog').getByRole('button', { name: 'Close', exact: true })
        if (await close.isVisible()) await close.click()
      } finally {
        if (saved) await page.evaluate(async saved => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          for (const [key, value] of Object.entries(saved.settings)) await store.dispatch('update' + key, value)
          store.commit('setTabsState', saved.tabs)
          store.commit('setPresentedTab', saved.tabs.presentedTabId)
        }, saved)
      }
    } finally {
      await browser.close()
    }
  }
})
