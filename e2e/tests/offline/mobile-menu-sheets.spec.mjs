import { test, expect, goTo, sel } from '../../helpers/app.mjs'
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

async function visibleBounds(target) {
  await expect(target).toBeVisible()
  const bounds = await target.boundingBox()
  if (!bounds) throw new Error('Mobile sheet test target has no visible bounding box')
  return bounds
}

async function openContext(page, session) {
  const title = page.locator('.ft-list-video .title').first()
  await title.click({ trial: true })
  const bounds = await visibleBounds(title)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }]
  })
  try {
    await expect(page.locator('.mobileLinkActions')).toBeVisible()
  } finally {
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
}
async function touchDrag(session, target, distance) {
  const bounds = await visibleBounds(target)
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

test('mobile menu sheets drag from rows and animate dismissal', { tag: '@scale' }, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await goTo(page, 'history')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  try {
    for (const kind of ['more', 'context']) {
      const menu = page.locator(kind === 'more' ? '.moreOptionContainer' : '.mobileLinkActions')
      const open = async () => {
        if (kind === 'more') await page.locator('.moreOptionNav').click()
        else await openContext(page, session)
        await expect(menu).toBeVisible()
        await waitForAnimation(menu)
      }
      await open()
      await expect(menu.locator('.bottomSheetHandle')).toBeVisible()
      await expect(menu).toHaveCSS('touch-action', 'none')
      await expect(menu.locator('.bottomSheetHandle')).toHaveCSS('touch-action', 'none')
      await expect(menu.locator(kind === 'more' ? '.moreOptionScroll' : '.mobileLinkActionsScroll')).toHaveCSS('touch-action', 'pan-down')
      if (kind === 'more') {
        const bounds = await visibleBounds(menu)
        // innerWidth and innerHeight round fractional zoomed viewports.
        expect(Math.abs(bounds.width - await page.evaluate(() => innerWidth))).toBeLessThan(1)
        expect(Math.abs(bounds.y + bounds.height - await page.evaluate(() => innerHeight))).toBeLessThan(1)
        const rows = menu.locator('.navOption')
        expect(await rows.first().evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48)
        await expect(menu.locator('.navLabel').first()).toBeVisible()
      }
      const row = menu.locator(kind === 'more' ? '.navOption' : '[role="menuitem"]').first()
      const before = await visibleBounds(menu)
      await touchDrag(session, row, 100)
      expect((await visibleBounds(menu)).y).toBeGreaterThan(before.y + 80)
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
        const screenshot = testInfo.outputPath(`${kind}-${colorScheme}.png`)
        await expectImagesLoaded(page.locator('.ft-list-video .thumbnailImage:not(.retryImagePlaceholder):not(.thumbnailPreview)'))
        await page.mouse.move(0, 0)
        await menu.screenshot({ path: screenshot })
        await testInfo.attach(`${kind} sheet ${colorScheme}`, { path: screenshot, contentType: 'image/png' })
        await page.keyboard.press('Escape')
        await expect(menu).toHaveCount(0)
      }
    }
  } finally {
    await session.detach()
  }
})

test('mobile context sheet preserves scrolling and dismisses from its handle in submenus', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 420 })
  await goTo(page, 'history')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  try {
    await openContext(page, session)
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
    const before = await visibleBounds(menu)
    await touchDrag(session, scroller, 60)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    expect((await visibleBounds(menu)).y).toBeCloseTo(before.y, 0)
    await expect(menu).toBeVisible()
    await touchDrag(session, menu.locator('.bottomSheetHandle'), 100)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(menu).toHaveCount(0)

    await openContext(page, session)
    await menu.getByRole('menuitem', { name: 'Copy Link', exact: true }).click()
    await expect(menu.getByRole('button', { name: 'Back', exact: true })).toBeVisible()
    await touchDrag(session, menu.locator('.bottomSheetHandle'), 100)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(menu).toHaveCount(0)
  } finally {
    await session.detach()
  }
})

test('mobile sheet remains tappable with reduced motion enabled', async ({ page }) => {
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

test('More sheet clamps bottom scrolling after resize and removing navigation entries or pins', async ({ page }) => {
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
    const store = window.$store
    store.commit('setNavigationItems', store.getters.getNavigationItems.filter(id => id !== 'stats'))
  })
  await clamped()
  // Sync can also remove pins while the sheet lists them.
  await page.evaluate(() => window.$store.dispatch('updatePinnedChannels', ['a', 'b', 'c'].map(letter => (
    { id: `UC${letter.repeat(22)}`, name: `Channel ${letter}`, thumbnail: null }
  ))))
  await bottom()
  await page.evaluate(() => window.$store.dispatch('updatePinnedChannels', []))
  await clamped()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('sheet dismissal uses the release position when the last touchmove is coalesced', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.locator('.moreOptionNav').click()
  const menu = page.locator('.moreOptionContainer')
  await waitForAnimation(menu)
  // CDP cannot force WebView to omit its final touchmove. Synthetic events
  // deterministically provide a release beyond the last delivered move; the
  // preceding tests cover actionability with real touch holds and drags.
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
  await page.evaluate(() => window.$store.dispatch('updateAnimationSpeed', 25))
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
  await expect.poll(() => page.evaluate(() => window.$store.getters.isAnyPromptOpen)).toBe(false)
  await expect(page.locator('.sideNav')).toHaveJSProperty('inert', false)
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
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 10, clientX: 180, clientY: 570, cancelable: true }))
    } finally {
      performance.now = originalNow
    }
  })
  await expect(menu).toHaveCount(0)
})

for (const pointerType of ['mouse', 'touch']) {
  for (const releaseOnly of [true, false]) {
    test(`short ${pointerType} pulls settle back with ${releaseOnly ? 'only a release sample' : 'slow movement after activation'}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      await page.locator('.moreOptionNav').click()
      const menu = page.locator('.moreOptionContainer')
      await waitForAnimation(menu)
      await menu.evaluate((element, { pointerType, releaseOnly }) => {
        const handle = element.querySelector('.bottomSheetHandle')
        const originalNow = performance.now
        let elapsed = 0
        performance.now = () => elapsed
        const touch = y => new Touch({ identifier: 11, target: handle, clientX: 180, clientY: y })
        try {
          handle.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, pointerType, pointerId: 11, isPrimary: true, button: 0, clientX: 180, clientY: 500
          }))
          elapsed = 1000
          if (!releaseOnly) {
            if (pointerType === 'touch') {
              handle.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch(550)] }))
            } else {
              window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 11, clientX: 180, clientY: 550, cancelable: true }))
            }
            elapsed = 1020
          }
          const end = releaseOnly ? 540 : 560
          if (pointerType === 'touch') {
            handle.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [touch(end)] }))
          } else {
            window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, clientX: 180, clientY: end, cancelable: true }))
          }
        } finally {
          performance.now = originalNow
        }
      }, { pointerType, releaseOnly })
      await expect(menu).toBeVisible()
      await expect.poll(() => menu.evaluate(element => getComputedStyle(element).transform)).toBe('none')
    })
  }
}

test('tall mobile context sheet keeps its handle below the top safe area', { tag: '@scale' }, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 420 })
  await goTo(page, 'history')
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-inset-top', '32px'))
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  try {
    await openContext(page, session)
    const menu = page.locator('.mobileLinkActions')
    await waitForAnimation(menu)
    const bounds = await visibleBounds(menu)
    expect(bounds.y).toBeGreaterThanOrEqual(32)
    expect(bounds.y + bounds.height).toBeCloseTo(await page.evaluate(() => innerHeight), 0)
    const scroller = menu.locator('.mobileLinkActionsScroll')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const handle = menu.locator('.bottomSheetHandle')
    expect((await visibleBounds(handle)).y).toBeGreaterThanOrEqual(32)
    await touchDrag(session, handle, 100)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(menu).toHaveCount(0)
  } finally {
    await session.detach()
  }
})

for (const kind of ['more', 'context']) {
  for (const remainingFinger of [true, false]) {
    test(`${kind} sheet cancels a two-finger release with ${remainingFinger ? 'one finger still held' : 'both fingers lifted'}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      await goTo(page, 'history')
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      try {
        if (kind === 'more') await page.locator('.moreOptionNav').click()
        else await openContext(page, session)
        const menu = page.locator(kind === 'more' ? '.moreOptionContainer' : '.mobileLinkActions')
        await waitForAnimation(menu)
        await menu.evaluate((element, remainingFinger) => {
          const handle = element.querySelector('.bottomSheetHandle')
          const bounds = handle.getBoundingClientRect()
          const x = bounds.x + bounds.width / 2; const y = bounds.y + bounds.height / 2
          const first = new Touch({ identifier: 12, target: handle, clientX: x, clientY: y + (remainingFinger ? 0 : 20) })
          const second = new Touch({ identifier: 13, target: handle, clientX: x, clientY: y + 120 })
          handle.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, pointerType: 'touch', pointerId: 12, isPrimary: true, button: 0, clientX: x, clientY: y
          }))
          if (!remainingFinger) {
            handle.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [first] }))
          }
          // Give the unrelated release its own coordinates and control the
          // remaining fingers explicitly; the next drag uses real touch input.
          handle.dispatchEvent(new TouchEvent('touchend', {
            bubbles: true,
            cancelable: true,
            touches: remainingFinger ? [first] : [],
            changedTouches: remainingFinger ? [second] : [second, first]
          }))
          if (remainingFinger) {
            handle.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [first] }))
          }
        }, remainingFinger)
        await expect(menu).toBeVisible()
        await expect.poll(() => menu.evaluate(element => getComputedStyle(element).transform)).toBe('none')
        await touchDrag(session, menu.locator('.bottomSheetHandle'), 100)
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(menu).toHaveCount(0)
      } finally {
        await session.detach()
      }
    })
  }
}

test('navigation helper selects one usable overflow link in mobile and desktop layouts', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.locator('.moreOptionNav').click()
  const menu = page.locator('.moreOptionContainer')
  await waitForAnimation(menu)
  const link = page.locator(sel.sideNavLink('subscribedchannels'))
  await expect(link).toHaveCount(1)
  await link.click()
  await expect(page).toHaveURL(/#\/subscribedchannels/)
  await expect(menu).toHaveCount(0)
  await page.setViewportSize({ width: 1024, height: 812 })
  await expect(page.locator(sel.sideNavLink('history'))).toHaveCount(1)
  await page.locator(sel.sideNavLink('history')).click()
  await expect(page).toHaveURL(/#\/history/)
})

for (const kind of ['more', 'context']) {
  test(`${kind} sheet ignores a drag during exit and permits dragging after reopening`, async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width: 375, height: 812 })
    await goTo(page, 'history')
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    try {
      const menu = page.locator(kind === 'more' ? '.moreOptionContainer' : '.mobileLinkActions')
      const open = async () => {
        if (kind === 'more') await page.locator('.moreOptionNav').click()
        else await openContext(page, session)
        await waitForAnimation(menu)
      }
      await open()
      // Capture the first exit frame and dispatch into its retained DOM before
      // actionability can wait for the short animation to finish.
      const retained = await menu.evaluate(element => {
        const handle = element.querySelector('.bottomSheetHandle')
        element.parentElement.click()
        return new Promise(resolve => requestAnimationFrame(() => {
          const bounds = handle.getBoundingClientRect()
          const x = bounds.x + bounds.width / 2; const y = bounds.y + bounds.height / 2
          handle.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y
          }))
          window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: y + 100 }))
          window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: y + 100 }))
          resolve(element.isConnected && element.getAnimations().some(animation => animation.effect.getKeyframes().at(-1).transform === 'translateY(100%)'))
        }))
      })
      expect(retained).toBe(true)
      await expect(menu).toHaveCount(0)
      expect(errors).toEqual([])
      await open()
      await touchDrag(session, menu.locator('.bottomSheetHandle'), 100)
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(menu).toHaveCount(0)
      expect(errors).toEqual([])
    } finally {
      await session.detach()
    }
  })
}

test('More sheet ignores Tab during exit and restores focus trapping after reopening', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.setViewportSize({ width: 375, height: 812 })
  // Slow the existing animation setting so real key input can reliably land
  // inside the retained exit interval even on a busy runner.
  await page.evaluate(() => window.$store.dispatch('updateAnimationSpeed', 25))
  const trigger = page.locator('.moreOptionNav')
  const menu = page.locator('.moreOptionContainer')
  await trigger.click()
  await waitForAnimation(menu)
  await expect(menu).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(1)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(menu).toHaveCount(0)
  expect(errors).toEqual([])
  await expect(trigger).toBeFocused()
  await trigger.click()
  await waitForAnimation(menu)
  await page.keyboard.press('Tab')
  await expect(menu.locator('a[href]').first()).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(menu.locator('a[href]').last()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  expect(errors).toEqual([])
})
