import { test, expect, goTo } from '../../helpers/app.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

const VIDEO_ID = 'jNQXAC9IVRw'
test.use({
  seed: {
    settings: { backendFallback: true, baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light' },
    history: [{
      _id: VIDEO_ID,
      videoId: VIDEO_ID,
      title: 'Video menu test',
      author: 'Test Channel',
      authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
      published: Date.now(),
      timeWatched: Date.now(),
      lengthSeconds: 60,
      watchProgress: 10,
      isWatched: false,
      type: 'video'
    }]
  }
})

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/i\.ytimg\.com\/vi\//, route => fulfillVisualFixture(route, 'video-thumbnail'))
})

async function openContext(page) {
  await page.locator('.ft-list-video .title').first().evaluate(element => element.dispatchEvent(new PointerEvent('contextmenu', {
    bubbles: true, cancelable: true, pointerType: 'touch'
  })))
}
async function touchDrag(session, target, distance) {
  const bounds = await target.boundingBox()
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + Math.min(20, bounds.height / 2) }
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  for (let step = 1; step <= 5; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + distance * step / 5 }]
    })
  }
}
async function waitForAnimation(menu) {
  await menu.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
}

for (const uiScale of [100, 125]) {
  test(`mobile menu sheets drag from rows and animate dismissal at ${uiScale}%`, async ({ app, page }, testInfo) => {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale / 100), uiScale)
    await page.setViewportSize({ width: 375, height: 812 })
    await goTo(page, 'history')
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    try {
      for (const kind of ['more', 'context']) {
        const menu = page.locator(kind === 'more' ? '.moreOptionContainer' : '.mobileLinkActions')
        const open = async () => {
          if (kind === 'more') await page.locator('.moreOptionNav').click()
          else await openContext(page)
          await expect(menu).toBeVisible()
          await waitForAnimation(menu)
        }
        await open()
        await expect(menu.locator('.bottomSheetHandle')).toBeVisible()
        await expect(menu).toHaveCSS('touch-action', 'none')
        await expect(menu.locator('.bottomSheetHandle')).toHaveCSS('touch-action', 'none')
        await expect(menu.locator(kind === 'more' ? '.moreOptionScroll' : '.mobileLinkActionsScroll')).toHaveCSS('touch-action', 'pan-down')
        if (kind === 'more') {
          const bounds = await menu.boundingBox()
          expect(bounds.width).toBeCloseTo(await page.evaluate(() => innerWidth), 0)
          expect(bounds.y + bounds.height).toBeCloseTo(await page.evaluate(() => innerHeight), 0)
          const rows = menu.locator('.navOption')
          expect(await rows.first().evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48)
          await expect(menu.locator('.navLabel').first()).toBeVisible()
        }
        const row = menu.locator(kind === 'more' ? '.navOption' : '[role="menuitem"]').first()
        const before = await menu.boundingBox()
        await touchDrag(session, row, 100)
        expect((await menu.boundingBox()).y).toBeGreaterThan(before.y + 80)
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(menu).toHaveCount(0)
        await expect(page).toHaveURL(/#\/history/)

        await open()
        // A short pull settles back and must not activate the row.
        await touchDrag(session, row, 16)
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(menu).toBeVisible()
        await expect.poll(() => menu.evaluate(element => getComputedStyle(element).transform)).toBe('none')
        await expect(page).toHaveURL(/#\/history/)

        // Outside dismissal retains the sheet until its fast exit completes.
        const leaving = await menu.evaluate(element => {
          const backdrop = element.parentElement
          backdrop.click()
          return new Promise(resolve => requestAnimationFrame(() => resolve({
            connected: element.isConnected,
            animations: element.getAnimations().map(animation => animation.effect.getKeyframes())
          })))
        })
        expect(leaving.connected).toBe(true)
        expect(leaving.animations.some(frames => frames.at(-1).transform === 'translateY(100%)')).toBe(true)
        await expect(menu).toHaveCount(0)

        for (const colorScheme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme })
          await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
          await open()
          const screenshot = testInfo.outputPath(`${kind}-${colorScheme}-${uiScale}.png`)
          await expectImagesLoaded(page.locator('.ft-list-video .thumbnailImage:not(.retryImagePlaceholder):not(.thumbnailPreview)'))
          await page.mouse.move(0, 0)
          await menu.screenshot({ path: screenshot })
          await testInfo.attach(`${kind} sheet ${colorScheme} ${uiScale}`, { path: screenshot, contentType: 'image/png' })
          await page.keyboard.press('Escape')
          await expect(menu).toHaveCount(0)
        }
      }
    } finally {
      await session.detach()
    }
  })
}

test('mobile context sheet preserves scrolling and dismisses from its handle in submenus', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 420 })
  await goTo(page, 'history')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  try {
    await openContext(page)
    const menu = page.locator('.mobileLinkActions')
    await waitForAnimation(menu)
    const scroller = menu.locator('.mobileLinkActionsScroll')
    // Use a real upward touch to verify that drag dismissal leaves native
    // scrolling available before testing downward movement away from the top.
    await touchDrag(session, scroller, -80)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await scroller.evaluate(element => { element.scrollTop = 100000 })
    const offset = await scroller.evaluate(element => element.scrollTop)
    expect(offset).toBeGreaterThan(0)
    const before = await menu.boundingBox()
    await touchDrag(session, scroller, 60)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    expect((await menu.boundingBox()).y).toBeCloseTo(before.y, 0)
    await expect(menu).toBeVisible()
    await touchDrag(session, menu.locator('.bottomSheetHandle'), 100)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(menu).toHaveCount(0)

    await openContext(page)
    await menu.getByRole('menuitem', { name: 'Copy Link', exact: true }).click()
    await expect(menu.getByRole('button', { name: 'Back', exact: true })).toBeVisible()
    await touchDrag(session, menu.locator('.bottomSheetHandle'), 100)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(menu).toHaveCount(0)
  } finally {
    await session.detach()
  }
})

test('mobile sheet dismissal respects reduced motion and remains tappable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await goTo(page, 'history')
  await page.locator('.moreOptionNav').click()
  const menu = page.locator('.moreOptionContainer')
  await expect(menu).toBeVisible()
  await menu.locator('a[href="#/subscribedchannels"]').click()
  await expect(menu).toHaveCount(0)
  await expect(page).toHaveURL(/#\/subscribedchannels/)
})

test('More sheet clamps bottom scrolling after resize and removing navigation entries', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.locator('.moreOptionNav').click()
  const menu = page.locator('.moreOptionContainer')
  const scroller = menu.locator('.moreOptionScroll')
  await waitForAnimation(menu)
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px' })
  await page.setViewportSize({ width: 375, height: 375 })
  const bottom = async () => {
    await expect.poll(() => scroller.evaluate(element => {
      element.scrollTop = 100000
      return element.scrollTop
    })).toBeGreaterThan(0)
  }
  const clamped = async () => {
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
    await expect(scroller.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
    await expect(menu.locator('.navOption').last()).toBeInViewport()
  }
  await bottom()
  await page.setViewportSize({ width: 667, height: 812 })
  await clamped()
  await page.setViewportSize({ width: 375, height: 375 })
  await bottom()
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setNavigationItems', store.getters.getNavigationItems.filter(id => id !== 'stats'))
  })
  await clamped()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('sheet dismissal uses the release position when the last touchmove is coalesced', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.locator('.moreOptionNav').click()
  const menu = page.locator('.moreOptionContainer')
  await waitForAnimation(menu)
  await menu.evaluate(element => {
    const row = element.querySelector('a')
    const bounds = row.getBoundingClientRect()
    const x = bounds.x + 20; const y = bounds.y + 20
    const touch = offset => new Touch({ identifier: 7, target: row, clientX: x, clientY: y + offset })
    row.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: x, clientY: y
    }))
    row.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch(30)] }))
    row.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [touch(120)] }))
  })
  await expect(menu).toHaveCount(0)
})

test('dragging during entry takes over from the current visual position', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setAnimationSpeed', 25))
  await page.locator('.moreOptionNav').click()
  const menu = page.locator('.moreOptionContainer')
  const movement = await menu.evaluate(element => {
    const handle = element.querySelector('.bottomSheetHandle')
    const before = new DOMMatrixReadOnly(getComputedStyle(element).transform).m42
    handle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, pointerType: 'mouse', pointerId: 9, isPrimary: true, button: 0, clientX: 180, clientY: 700
    }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: 180, clientY: 750, cancelable: true }))
    const after = new DOMMatrixReadOnly(getComputedStyle(element).transform).m42
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 9 }))
    return { before, after }
  })
  expect(movement.before).toBeGreaterThan(0)
  expect(movement.after - movement.before).toBeCloseTo(50, 0)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('More sheet closes and releases modal state when leaving mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const originalOverflow = await page.evaluate(() => document.documentElement.style.overflow)
  await page.locator('.moreOptionNav').click()
  const menu = page.locator('.moreOptionContainer')
  await waitForAnimation(menu)
  await page.setViewportSize({ width: 680, height: 812 })
  await expect(menu).toBeVisible()
  await page.setViewportSize({ width: 681, height: 812 })
  await expect(page.locator('.moreOptionNav')).toBeHidden()
  await expect(menu).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe(originalOverflow)
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.isAnyPromptOpen)).toBe(false)
  await expect.poll(() => page.locator('.sideNav').evaluate(element => element.inert)).toBe(false)
})

test('a short downward flick dismisses after dwelling on the handle', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.locator('.moreOptionNav').click()
  const menu = page.locator('.moreOptionContainer')
  await waitForAnimation(menu)
  await menu.evaluate(element => {
    const handle = element.querySelector('.bottomSheetHandle')
    const originalNow = performance.now
    // Simulate a hold before the flick without a timing sleep.
    let elapsed = 0
    performance.now = () => elapsed
    try {
      handle.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerType: 'mouse', pointerId: 10, isPrimary: true, button: 0, clientX: 180, clientY: 500
      }))
      elapsed = 1000
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 10, clientX: 180, clientY: 550, cancelable: true }))
      elapsed = 1020
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 10, clientX: 180, clientY: 560, cancelable: true }))
    } finally {
      performance.now = originalNow
    }
  })
  await expect(menu).toHaveCount(0)
})
