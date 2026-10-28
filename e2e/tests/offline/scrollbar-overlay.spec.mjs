import { test, expect, goToSettingsSection, sel, waitForAppReady } from '../../helpers/app.mjs'

// The page's own scrollbars are the ones appended to the body.
const PAGE_SCROLLBAR = 'body > .os-scrollbar-vertical'

/** The assertions below only mean anything once there is something to scroll. */
const pageOverflows = (page) => page.evaluate(
  () => document.documentElement.scrollHeight > window.innerHeight
)

async function pageScrollbarRangeError(page) {
  return page.evaluate(() => {
    const root = document.documentElement
    const handle = document.querySelector('body > .os-scrollbar-vertical .os-scrollbar-handle')
    const viewportFraction = Number(getComputedStyle(handle).getPropertyValue('--os-viewport-percent'))
    return Math.abs(root.clientHeight / viewportFraction - root.scrollHeight) * devicePixelRatio
  })
}

async function addPageOverflow(page) {
  await page.evaluate(() => {
    const content = document.createElement('div')
    content.dataset.scrollbarTestContent = ''
    content.style.height = '3000px'
    document.body.append(content)
  })
  await expect.poll(() => pageOverflows(page)).toBe(true)
}

async function recordCustomSpeedPageScroll(page) {
  await addPageOverflow(page)
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setScrollSpeed', 200)
    window.__scrollSpeedAnimationPositions = []
    document.addEventListener('scroll', () => {
      window.__scrollSpeedAnimationPositions.push(window.scrollY)
    })
  })
}

async function addNestedCustomSpeedScroller(page, attribute, scrollTop) {
  await page.evaluate(({ attribute, scrollTop }) => {
    const viewport = document.createElement('div')
    viewport.setAttribute(attribute, '')
    Object.assign(viewport.style, {
      height: '100px',
      left: '100px',
      overflowY: 'auto',
      position: 'fixed',
      top: '100px',
      width: '200px',
      zIndex: '9999',
    })
    const content = document.createElement('div')
    content.style.height = '300px'
    viewport.append(content)
    document.body.append(viewport)

    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$store
    app._context.directives['overlay-scrollbars'].mounted(viewport, { value: true })
    store.commit('setScrollSpeed', 200)
    viewport.scrollTop = scrollTop
  }, { attribute, scrollTop })

  return page.locator(`[${attribute}]`)
}

test.describe('overlay scrollbars', () => {
  test('coalesces page overflow measurements as individual feed enter animations finish', { tag: '@performance' }, async ({ page }) => {
    await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
    await addPageOverflow(page)
    const scrollReads = await page.evaluate(async () => {
      const grid = document.createElement('div')
      grid.className = 'autoGrid'
      for (let index = 0; index < 100; index++) {
        const card = document.createElement('div')
        card.className = 'grid feed-enter-active feed-enter-to'
        card.textContent = `Video ${index}`
        grid.append(card)
      }
      document.body.append(grid)
      await new Promise(resolve => setTimeout(resolve, 100))

      const root = document.documentElement
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth')
      let reads = 0
      Object.defineProperty(root, 'scrollWidth', {
        configurable: true,
        get() { reads++; return descriptor.get.call(this) }
      })
      try {
        // Transition end events arrive in separate tasks. The entry remains
        // in normal flow; only its opacity/transform transition is removed.
        await Promise.all([...grid.children].map(card => new Promise(resolve => setTimeout(() => {
          card.classList.remove('feed-enter-active', 'feed-enter-to')
          resolve()
        }, 0))))
        await new Promise(resolve => setTimeout(resolve, 100))
        return reads
      } finally {
        delete root.scrollWidth
        grid.remove()
      }
    })
    expect(scrollReads).toBeLessThan(10)
  })

  test('avoids full page scrollbar updates for content changes with stable dimensions', { tag: '@performance' }, async ({ page }) => {
    await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
    await addPageOverflow(page)
    const viewportReads = await page.evaluate(async () => {
      const element = document.createElement('div')
      element.style.cssText = 'position: fixed; width: 100px; height: 100px'
      document.body.append(element)
      await new Promise(resolve => setTimeout(resolve, 100))
      const root = document.documentElement
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
      let reads = 0
      Object.defineProperty(root, 'clientWidth', {
        configurable: true,
        get() { reads++; return descriptor.get.call(this) }
      })
      try {
        for (let index = 0; index < 40; index++) {
          element.style.opacity = index % 2 ? '0.5' : '1'
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        }
        return reads
      } finally {
        delete root.clientWidth
        element.remove()
      }
    })
    expect(viewportReads).toBeLessThan(10)
  })

  test('remeasures settled page overflow after bottom-row feed enter animations', { tag: '@scale' }, async ({ page }) => {
    await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
    await page.evaluate(() => {
      window.$store.commit('setReducedMotion', 'off')
    })
    await page.evaluate(() => {
      const style = document.createElement('style')
      style.textContent = `
        body { padding-bottom: 0 !important; }
        [data-enter-overflow] .feed-enter-active { transition: transform 200ms linear; }
        [data-enter-overflow] .feed-enter-from { transform: translateY(10px); }
      `
      document.head.append(style)
      const grid = document.createElement('div')
      grid.className = 'autoGrid'
      grid.dataset.enterOverflow = ''
      const card = document.createElement('div')
      card.style.height = '1500px'
      card.className = 'feed-enter-from'
      grid.append(card)
      document.body.append(grid)
      window.scrollTo(0, document.documentElement.scrollHeight)
    })
    await expect.poll(() => pageScrollbarRangeError(page)).toBeLessThanOrEqual(2)
    const initialTransform = await page.evaluate(async () => {
      const card = document.querySelector('[data-enter-overflow] > div')
      card.classList.add('feed-enter-active')
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      card.classList.remove('feed-enter-from')
      card.classList.add('feed-enter-to')
      return new DOMMatrixReadOnly(getComputedStyle(card).transform).m42
    })
    expect(initialTransform).toBeGreaterThan(0)
    const card = page.locator('[data-enter-overflow] > div')
    await expect(card).toHaveCSS('transform', 'none')
    await card.evaluate(element => {
      element.classList.remove('feed-enter-active', 'feed-enter-to')
    })
    await expect.poll(() => pageScrollbarRangeError(page)).toBeLessThanOrEqual(2)
    await expect.poll(() => page.evaluate(() => {
      const root = document.documentElement
      const contentEnd = document.body.getBoundingClientRect().bottom + window.scrollY
      return Math.abs(root.scrollHeight - Math.max(root.clientHeight, contentEnd)) * devicePixelRatio
    })).toBeLessThanOrEqual(2)
  })

  test('updates page overflow when loaded image dimensions grow', async ({ page }) => {
    await expect(page.locator('.tutorialOverlay')).toHaveCount(0)
    await page.evaluate(async () => {
      const image = new Image()
      image.dataset.pageScrollbarImage = ''
      image.style.display = 'block'
      image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'
      document.body.append(image)
      await image.decode()
    })
    await expect.poll(() => pageScrollbarRangeError(page)).toBeLessThanOrEqual(2)
    await page.evaluate(async () => {
      const image = document.querySelector('[data-page-scrollbar-image]')
      image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="4000"/>'
      await image.decode()
    })
    await expect.poll(() => pageOverflows(page)).toBe(true)
    await expect.poll(() => pageScrollbarRangeError(page)).toBeLessThanOrEqual(2)
  })

  test('page and nested scrollbar handles follow live UI roundness changes', async ({ page }) => {
    await addPageOverflow(page)
    const viewport = await addNestedCustomSpeedScroller(page, 'data-roundness-scrollbar', 0)
    for (const width of [4, 10]) {
      await page.evaluate(value => {
        window.$store.commit('setScrollbarThumbWidth', value)
      }, width)
      for (const roundness of [0, 50, 100, 200]) {
        await page.evaluate(value => {
          window.$store.commit('setUiRoundness', value)
        }, roundness)
        for (const scrollbar of [page.locator(PAGE_SCROLLBAR), viewport.locator(':scope > .os-scrollbar-vertical')]) {
          await expect(scrollbar.locator('.os-scrollbar-handle')).toHaveCSS('border-radius', `${width * roundness / 100}px`)
        }
      }
    }
  })

  test('preserves native keyboard scrolling and clamps a fractional viewport after content shrinks', async ({ page }) => {
    const viewport = await addNestedCustomSpeedScroller(page, 'data-keyboard-scrollbar', 0)
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    await viewport.evaluate(element => {
      element.tabIndex = 0
      element.style.height = '100.5px'
      element.focus()
    })
    await page.keyboard.press('PageDown')
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(50)
    await viewport.evaluate(element => {
      element.scrollTop = element.scrollHeight
      element.firstElementChild.style.height = '50px'
      element.style.height = '150.5px'
    })
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(0)
    await expect(viewport.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
    await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
  })

  test('changes idle visibility without rebuilding retained scrollbars or losing their offset', async ({ page }) => {
    const viewport = await addNestedCustomSpeedScroller(page, 'data-retained-scrollbar', 180)
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(170)
    await page.evaluate(() => {
      window.__retainedScrollbar = document.querySelector('[data-retained-scrollbar] > .os-scrollbar-vertical')
    })
    for (const alwaysShow of [true, false, true]) {
      await page.evaluate(enabled => {
        window.$store.commit('setAlwaysShowScrollbars', enabled)
      }, alwaysShow)
      await expect.poll(() => page.evaluate(() =>
        document.querySelector('[data-retained-scrollbar] > .os-scrollbar-vertical') === window.__retainedScrollbar
      )).toBe(true)
      await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(170)
    }
  })

  test('does not rewrite visible scrollbar classes on every scroll frame', { tag: '@performance' }, async ({ page }) => {
    await addPageOverflow(page)
    for (const zoomFactor of [1, 1.25]) {
      await page.evaluate((factor) => window.ftElectron.setZoomFactor(factor), zoomFactor)
      await page.mouse.move(800, 400)
      await page.mouse.wheel(0, 100)
      await expect(page.locator(PAGE_SCROLLBAR)).toHaveCSS('opacity', '1')

      const classMutations = await page.evaluate(async () => {
        let mutations = 0
        const observer = new MutationObserver(records => { mutations += records.length })
        for (const scrollbar of document.querySelectorAll('body > .os-scrollbar')) {
          observer.observe(scrollbar, { attributes: true, attributeFilter: ['class'] })
        }
        for (let frame = 0; frame < 30; frame++) {
          window.scrollTo(0, 200 + frame * 10)
          await new Promise(resolve => requestAnimationFrame(resolve))
        }
        await new Promise(resolve => requestAnimationFrame(resolve))
        observer.disconnect()
        return mutations
      })

      expect(classMutations).toBe(0)
      await expect(page.locator(PAGE_SCROLLBAR)).toHaveCSS('opacity', '1')
    }
  })

  test('positions the bars from scroll events without scroll-linked animations', { tag: '@scale' }, async ({ page, uiScale }) => {
    await page.addInitScript(() => { delete window.ScrollTimeline })
    await page.reload()
    await waitForAppReady(page)
    await addPageOverflow(page)
    const handleTop = () => page.locator(`${PAGE_SCROLLBAR} .os-scrollbar-handle`).evaluate(element => element.getBoundingClientRect().top)
    const initialHandleTop = await handleTop()
    await page.evaluate(() => window.scrollTo(0, 1000))
    await expect.poll(handleTop).toBeGreaterThan(initialHandleTop + 50)
    expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(await page.evaluate(() => window.innerWidth))

    // Nested containers that rely on the default overflow still scroll, with
    // their tracks in view and custom scroll speed applied.
    const viewport = await addNestedCustomSpeedScroller(page, 'data-scroll-event-scrollbar-test', 0)
    await viewport.evaluate(element => { element.style.removeProperty('overflow-y') })
    await viewport.hover()
    await page.mouse.wheel(0, 40)
    // Wheel deltas are device pixels, so UI scale changes the CSS scroll distance.
    await expect.poll(() => viewport.evaluate((element, distance) => Math.abs(element.scrollTop - distance), 80 * 100 / uiScale)).toBeLessThanOrEqual(1)
    await expect.poll(() => viewport.evaluate(element => {
      const view = element.getBoundingClientRect()
      const track = element.querySelector(':scope > .os-scrollbar-vertical .os-scrollbar-track').getBoundingClientRect()
      const handle = element.querySelector(':scope > .os-scrollbar-vertical .os-scrollbar-handle').getBoundingClientRect()
      const progress = element.scrollTop / (element.scrollHeight - element.clientHeight)
      return {
        trackStart: Math.round(track.top - view.top),
        handleOffset: Math.abs((handle.top - track.top) / (track.height - handle.height) - progress) < 0.02,
      }
    })).toEqual({ trackStart: 2, handleOffset: true })
  })

  test('remeasures the page after its scrolling is locked and unlocked', async ({ page }) => {
    await addPageOverflow(page)
    const scrollbar = page.locator(PAGE_SCROLLBAR)
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    await page.evaluate(() => { document.documentElement.style.overflow = 'hidden' })
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    await page.evaluate(() => { document.documentElement.style.overflow = '' })
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
  })

  test('follows a page direction change', async ({ page }) => {
    await addPageOverflow(page)
    const viewport = await addNestedCustomSpeedScroller(page, 'data-direction-scrollbar-test', 0)
    for (const scrollbar of [page.locator(PAGE_SCROLLBAR), viewport.locator(':scope > .os-scrollbar-vertical')]) {
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-rtl/)
      await page.evaluate(() => { document.body.dir = 'rtl' })
      await expect(scrollbar).toHaveClass(/os-scrollbar-rtl/)
      await page.evaluate(() => { document.body.dir = 'ltr' })
      await expect(scrollbar).not.toHaveClass(/os-scrollbar-rtl/)
    }
  })

  test('the main scroll container reserves no layout space for its scrollbar', async ({ page }) => {
    await addPageOverflow(page)

    // A classic scrollbar shrinks clientWidth below the viewport width, an
    // overlay one floats above the content and leaves the layout untouched.
    const { clientWidth, innerWidth } = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth
    }))

    expect(clientWidth).toBe(innerWidth)
  })

  test('applies the configured wheel speed to page scrolling', async ({ page }) => {
    await addPageOverflow(page)
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setScrollSpeed', 200)
      window.ftElectron.setZoomFactor(1.25)
      document.addEventListener('wheel', (event) => {
        window.__scrollSpeedTestDelta = event.deltaY
      }, { capture: true, once: true })
    })

    await page.mouse.move(800, 400)
    await page.mouse.wheel(0, 120)
    await expect.poll(() => page.evaluate(() => (
      window.__scrollSpeedTestDelta > 0 &&
      window.scrollY === window.__scrollSpeedTestDelta * 2
    ))).toBe(true)
  })

  test('animates wheel scrolling at a custom speed', async ({ page }) => {
    await recordCustomSpeedPageScroll(page)

    await page.mouse.move(800, 400)
    await page.mouse.wheel(0, 120)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(240)

    const positions = await page.evaluate(() => window.__scrollSpeedAnimationPositions)
    expect(new Set(positions).size).toBeGreaterThan(2)
  })

  test('preserves a burst of wheel deltas while custom scrolling is animated', async ({ page }) => {
    await addPageOverflow(page)
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setScrollSpeed', 200)

      for (let index = 0; index < 3; index++) {
        document.body.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 120,
        }))
      }
    })

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(720)
  })

  test('reverses a pending custom-speed scroll at the current boundary', async ({ page }) => {
    await addPageOverflow(page)
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setScrollSpeed', 200)

      for (const deltaY of [120, -120]) {
        document.body.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY,
        }))
      }
    })

    // The reversed scroll must not move the page while it settles.
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('the page scrollbar stays on the content side of right vertical tabs', async ({ page }) => {
    await addPageOverflow(page)
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setVerticalTabBarWidth', 220)
      store.commit('setTabBarPosition', 'right')
    })

    const [scrollbarBox, tabBarBox] = await Promise.all([
      page.locator(PAGE_SCROLLBAR).boundingBox(),
      page.locator('.tabBar.position-right').boundingBox()
    ])

    expect(Math.abs(scrollbarBox.x + scrollbarBox.width - tabBarBox.x)).toBeLessThanOrEqual(1)
  })

  test('the page scrollbar stays on the window edge with left vertical tabs', async ({ page }) => {
    await addPageOverflow(page)
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setVerticalTabBarWidth', 220)
      store.commit('setTabBarPosition', 'left')
    })

    await expect(page.locator('.tabBar.position-left')).toBeVisible()
    const scrollbarBox = await page.locator(PAGE_SCROLLBAR).boundingBox()
    const innerWidth = await page.evaluate(() => window.innerWidth)

    expect(Math.abs(scrollbarBox.x + scrollbarBox.width - innerWidth)).toBeLessThanOrEqual(1)
  })

  test('keeps the quick settings avatar clear of a wide page scrollbar', { tag: '@scale' }, async ({ page }) => {
    await addPageOverflow(page)
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setScrollbarThumbWidth', 20)
    })

    await expect.poll(async () => {
      const [avatarBox, scrollbarBox] = await Promise.all([
        page.locator('.topNav .profileTrigger').boundingBox(),
        page.locator(PAGE_SCROLLBAR).boundingBox()
      ])
      return scrollbarBox.x - (avatarBox.x + avatarBox.width)
    }).toBeGreaterThanOrEqual(5)

    await page.setViewportSize({ width: 400, height: 720 })
    await page.locator('.topNav .profileTrigger').click()
    const menuBox = await page.locator('.quickSettingsMenu').boundingBox()

    expect(menuBox.x).toBeGreaterThanOrEqual(0)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(await page.evaluate(() => window.visualViewport.width))
  })

  test('the scrollbar hides once the pointer rests and follows it back', async ({ page }) => {
    await addPageOverflow(page)
    const scrollbar = page.locator(PAGE_SCROLLBAR)

    await page.mouse.move(800, 400)
    await page.mouse.wheel(0, 300)
    await expect(scrollbar).toHaveCSS('opacity', '1')

    // Idle pointer: gone after the library's 1300ms auto hide delay.
    await expect(scrollbar).toHaveCSS('opacity', '0', { timeout: 5000 })

    await page.mouse.move(800, 500)
    await expect(scrollbar).toHaveCSS('opacity', '1')
  })

  test('the scrollbar handle picks up the theme', async ({ page, attachScreenshot }) => {
    await addPageOverflow(page)
    await page.mouse.wheel(0, 300)

    await expect(page.locator(`${PAGE_SCROLLBAR} .os-scrollbar-handle`)).toHaveCSS(
      'background-color',
      // --scrollbar-color of the light theme
      'rgb(204, 204, 204)'
    )
    await attachScreenshot('themed scrollbar handle')
  })

  test('clicks on a wide track outside the handle reach the content underneath', { tag: '@scale' }, async ({ page }) => {
    await addPageOverflow(page)
    await page.evaluate(() => {
      window.$store.commit('setScrollbarThumbWidth', 20)
      const button = document.createElement('button')
      button.dataset.scrollbarTestTarget = ''
      Object.assign(button.style, {
        position: 'fixed',
        insetInlineEnd: '0',
        insetBlockEnd: '0',
        inlineSize: '40px',
        blockSize: '40px',
        zIndex: '1'
      })
      button.addEventListener('click', () => { window.__scrollbarTestClicks = (window.__scrollbarTestClicks ?? 0) + 1 })
      document.body.append(button)
    })
    const scrollbar = page.locator(PAGE_SCROLLBAR)
    // An unusable scrollbar ignores pointers anyway, which would pass vacuously.
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    await page.mouse.move(800, 400)
    await expect(scrollbar).toHaveCSS('opacity', '1')

    // The handle sits at the top, so the bottom of the track is empty.
    const track = await scrollbar.locator('.os-scrollbar-track').boundingBox()
    const target = await page.locator('[data-scrollbar-test-target]').boundingBox()
    const x = track.x + track.width / 2
    const y = target.y + target.height / 2
    expect(x).toBeGreaterThan(target.x)
    expect(y).toBeLessThan(track.y + track.height)
    await page.mouse.click(x, y)

    expect(await page.evaluate(() => window.__scrollbarTestClicks)).toBe(1)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('dragging the page handle scrolls the document', async ({ page }) => {
    await addPageOverflow(page)
    await page.mouse.move(800, 400)

    const handle = page.locator(`${PAGE_SCROLLBAR} .os-scrollbar-handle`)
    await handle.hover()
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 100, { steps: 10 })
    await page.mouse.up()

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  })

  test('keeps a held page handle visible outside the track until release', async ({ page }) => {
    await addPageOverflow(page)
    const scrollbar = page.locator(PAGE_SCROLLBAR)
    await page.mouse.move(800, 400)
    await expect(scrollbar).toHaveCSS('opacity', '1')
    const handleBox = await scrollbar.locator('.os-scrollbar-handle').boundingBox()
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(800, 500)
    // Outlast the 1300ms auto hide delay while the handle is held.
    await page.waitForTimeout(1600)
    await expect(scrollbar).toHaveCSS('opacity', '1')
    await page.mouse.up()
    await expect(scrollbar).toHaveCSS('opacity', '0', { timeout: 5000 })
  })

  test('keeps the page handle under the pointer when content loads during a drag', async ({ page }) => {
    await addPageOverflow(page)
    await page.mouse.move(800, 400)

    const handle = page.locator(`${PAGE_SCROLLBAR} .os-scrollbar-handle`)
    await handle.hover()
    const initialBox = await handle.boundingBox()
    const pointerX = initialBox.x + initialBox.width / 2
    const pointerY = initialBox.y + initialBox.height / 2 + 150

    await page.mouse.move(initialBox.x + initialBox.width / 2, initialBox.y + initialBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(pointerX, pointerY)

    const heightBefore = await handle.evaluate((element) => element.clientHeight)
    await page.evaluate(() => {
      const addedContent = document.createElement('div')
      addedContent.style.height = '3000px'
      document.body.append(addedContent)
    })

    await expect.poll(() => handle.evaluate((element) => element.clientHeight)).toBeLessThan(heightBefore)
    await expect.poll(async () => {
      const box = await handle.boundingBox()
      return Math.abs(box.y + box.height / 2 - pointerY)
    }).toBeLessThan(2)

    await page.mouse.up()
  })

  test.describe('a nested scroll container', () => {
    test('clamps wrapped content after a width-only resize at fractional zoom during touch scrolling', async ({ page }) => {
      await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      await expect.poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
      await page.evaluate(() => {
        const viewport = document.createElement('div')
        viewport.dataset.widthResizeScrollbarTest = ''
        Object.assign(viewport.style, {
          position: 'fixed',
          top: '100px',
          left: '100px',
          width: '100px',
          height: '200px',
          overflow: 'auto',
          zIndex: '9999',
        })
        const content = document.createElement('div')
        Object.assign(content.style, { fontFamily: 'monospace', fontSize: '16px', lineHeight: '20px' })
        content.textContent = 'word '.repeat(75)
        viewport.append(content)
        document.body.append(viewport)
        document.querySelector('#app').__vue_app__._context.directives['overlay-scrollbars'].mounted(viewport, { value: true })
      })
      const viewport = page.locator('[data-width-resize-scrollbar-test]')
      await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(200)
      await viewport.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(200)
      await viewport.evaluate(element => { element.style.width = '600px' })
      await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(0)
      await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
      await expect(viewport.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
      await session.detach()
    })

    const now = Date.now()
    test.use({
      seed: {
        settings: { enableSearchSuggestions: false },
        searchHistory: Array.from({ length: 25 }, (_, index) => ({
          _id: `search ${index + 1}`,
          lastUpdatedAt: now - index
        }))
      }
    })

    test('stays the scrolling element, so scrollTop keeps working', async ({ page }) => {
      await page.locator(sel.searchInput).click()
      const list = page.locator('.topNav .searchContainer .options .list')
      await expect(list).toBeVisible()

      const measurements = await list.evaluate((element) => {
        const overflows = element.scrollHeight > element.clientHeight
        element.scrollTop = 120
        return {
          overflows,
          noLayoutCost: element.clientWidth === element.offsetWidth,
          scrollTop: element.scrollTop
        }
      })

      expect(measurements.overflows).toBe(true)
      expect(measurements.noLayoutCost).toBe(true)
      expect(measurements.scrollTop).toBe(120)
    })

    test('avoids repeated visibility writes while scrolling', { tag: '@performance' }, async ({ page }) => {
      const viewport = await addNestedCustomSpeedScroller(page, 'data-idle-scrollbar-test', 0)
      const scrollbar = viewport.locator(':scope > .os-scrollbar-vertical')
      await viewport.hover()
      await expect(scrollbar).toHaveCSS('opacity', '1')

      const classMutations = await viewport.evaluate(async element => {
        let mutations = 0
        const observer = new MutationObserver(records => { mutations += records.length })
        for (const bar of element.querySelectorAll(':scope > .os-scrollbar')) {
          observer.observe(bar, { attributes: true, attributeFilter: ['class'] })
        }
        for (let frame = 0; frame < 30; frame++) {
          element.scrollTop = frame * 5
          await new Promise(resolve => requestAnimationFrame(resolve))
        }
        await new Promise(resolve => requestAnimationFrame(resolve))
        observer.disconnect()
        return mutations
      })
      expect(classMutations).toBe(0)
    })

    test('keeps measuring a child that moved into another scroll container', { tag: '@scale' }, async ({ page }) => {
      await page.evaluate(() => {
        const directive = document.querySelector('#app').__vue_app__._context.directives['overlay-scrollbars']
        // Observers run in creation order, so the receiving container sees the move first.
        for (const name of ['receiver', 'sender']) {
          const viewport = document.createElement('div')
          viewport.dataset.movedChildTest = name
          Object.assign(viewport.style, { position: 'fixed', top: '100px', left: name === 'receiver' ? '100px' : '400px', width: '200px', height: '100px', zIndex: '9999' })
          document.body.append(viewport)
          directive.mounted(viewport, { value: true })
        }
        const child = document.createElement('div')
        child.style.height = '50px'
        document.querySelector('[data-moved-child-test="sender"]').append(child)
      })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.evaluate(() => {
        const child = document.querySelector('[data-moved-child-test="sender"] > div:not(.os-scrollbar)')
        document.querySelector('[data-moved-child-test="receiver"]').prepend(child)
      })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.evaluate(() => {
        document.querySelector('[data-moved-child-test="receiver"] > div:not(.os-scrollbar)').style.height = '300px'
      })
      await expect(page.locator('[data-moved-child-test="receiver"] > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-visible/)
    })

    test('ends a handle drag when moving the bars releases the pointer', { tag: '@scale' }, async ({ page }) => {
      const viewport = await addNestedCustomSpeedScroller(page, 'data-lost-capture-test', 0)
      await viewport.hover()
      const box = await viewport.locator(':scope > .os-scrollbar-vertical .os-scrollbar-handle').boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 30)
      await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      // Replacing the children takes the bars along, which drops the capture.
      await viewport.evaluate(element => {
        const content = document.createElement('div')
        content.style.height = '300px'
        element.replaceChildren(content)
      })
      await expect(viewport.locator(':scope > .os-scrollbar-vertical')).toHaveCount(1)
      // Without the capture, a release away from the bar never reaches it.
      await page.mouse.move(20, 20)
      await page.mouse.up()
      await viewport.evaluate(element => { element.scrollTop = 0 })
      await viewport.evaluate(element => { element.firstElementChild.style.height = '400px' })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      expect(await viewport.evaluate(element => element.scrollTop)).toBe(0)
    })

    test('lets handle presses reach the container as scroll intent', async ({ page }) => {
      const viewport = await addNestedCustomSpeedScroller(page, 'data-handle-press-test', 0)
      await viewport.evaluate(element => element.addEventListener('pointerdown', event => {
        window.__handlePressReachedContainer = event.target.closest('.os-scrollbar-vertical') !== null
      }))
      await viewport.hover()
      const box = await viewport.locator(':scope > .os-scrollbar-vertical .os-scrollbar-handle').boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.up()
      expect(await page.evaluate(() => window.__handlePressReachedContainer)).toBe(true)
    })

    test('keeps hovered bars visible', async ({ page }) => {
      const viewport = await addNestedCustomSpeedScroller(page, 'data-idle-scrollbar-test', 0)
      const scrollbar = viewport.locator(':scope > .os-scrollbar-vertical')
      await viewport.hover()
      await expect(scrollbar).toHaveCSS('opacity', '1')
      await scrollbar.locator('.os-scrollbar-handle').hover()
      // Outlast the 1300ms auto hide delay while hovering.
      await page.waitForTimeout(1600)
      await expect(scrollbar).toHaveCSS('opacity', '1')
      await page.mouse.move(800, 500)
      await expect(scrollbar).toHaveCSS('opacity', '0', { timeout: 5000 })
    })

    test('cancels pending hides when always-show is enabled and restores idle hiding', async ({ page }) => {
      const viewport = await addNestedCustomSpeedScroller(page, 'data-idle-setting-test', 0)
      const scrollbar = viewport.locator(':scope > .os-scrollbar-vertical')
      await viewport.hover()
      await expect(scrollbar).toHaveCSS('opacity', '1')
      await page.evaluate(() => {
        window.$store
          .commit('setAlwaysShowScrollbars', true)
      })
      await page.mouse.move(800, 500)
      // Outlast the 1300ms auto hide delay with an idle pointer.
      await page.waitForTimeout(1600)
      await expect(scrollbar).toHaveCSS('opacity', '1')
      await page.evaluate(() => {
        window.$store
          .commit('setAlwaysShowScrollbars', false)
      })
      await expect(scrollbar).toHaveCSS('opacity', '0')
      await viewport.hover()
      await expect(scrollbar).toHaveCSS('opacity', '1')
    })

    test('keeps tracks in view with scroll-linked animations without extending the range', { tag: '@scale' }, async ({ page }) => {
      const viewport = await addNestedCustomSpeedScroller(page, 'data-scroll-linked-scrollbar-test', 0)
      const scrollbar = viewport.locator(':scope > .os-scrollbar-vertical')
      await expect(scrollbar).toHaveClass(/os-scrollbar-visible/)
      expect(await scrollbar.evaluate(element => ['.os-scrollbar-track', '.os-scrollbar-handle'].every(selector =>
        element.querySelector(selector).getAnimations().some(animation => animation.timeline instanceof ScrollTimeline)
      ))).toBe(true)

      const geometry = () => viewport.evaluate(element => {
        const view = element.getBoundingClientRect()
        const track = element.querySelector(':scope > .os-scrollbar-vertical .os-scrollbar-track').getBoundingClientRect()
        const handle = element.querySelector(':scope > .os-scrollbar-vertical .os-scrollbar-handle').getBoundingClientRect()
        return {
          trackStart: Math.round(track.top - view.top),
          trackEnd: Math.round(view.bottom - track.bottom),
          handleProgress: Math.round((handle.top - track.top) / (track.height - handle.height) * 100) / 100,
        }
      })
      for (const [scrollTop, handleProgress] of [[0, 0], [100, 0.5], [200, 1]]) {
        await viewport.evaluate((element, top) => { element.scrollTop = top }, scrollTop)
        await expect.poll(geometry).toEqual({ trackStart: 2, trackEnd: 2, handleProgress })
      }

      // Bars must not keep a range open that the shrunken content no longer has.
      await viewport.evaluate(element => { element.firstElementChild.style.height = '150px' })
      // Fractional UI scales can leave the end offset at a fractional pixel.
      await expect.poll(() => viewport.evaluate(element => ({
        scrollHeight: element.scrollHeight,
        atEnd: Math.abs(element.scrollTop - 50) <= 1,
      }))).toEqual({ scrollHeight: 150, atEnd: true })
      // At fractional UI scales the end offset can be fractional, which moves
      // the track by less than a pixel.
      await expect.poll(async () => {
        const { trackStart, trackEnd, handleProgress } = await geometry()
        return Math.abs(trackStart - 2) <= 1 && Math.abs(trackEnd - 2) <= 1 && handleProgress === 1
      }).toBe(true)
    })

    test('only adds a blocking wheel listener while a custom speed is active', async ({ page }) => {
      const listenerCounts = await page.evaluate(() => {
        const viewport = document.createElement('div')
        viewport.style.overflowY = 'auto'
        const content = document.createElement('div')
        content.style.height = '300px'
        viewport.append(content)
        document.body.append(viewport)

        const counts = { added: 0, removed: 0 }
        const addEventListener = viewport.addEventListener.bind(viewport)
        const removeEventListener = viewport.removeEventListener.bind(viewport)
        viewport.addEventListener = (type, listener, options) => {
          if (type === 'wheel' && options?.passive === false) counts.added++
          addEventListener(type, listener, options)
        }
        viewport.removeEventListener = (type, listener, options) => {
          if (type === 'wheel') counts.removed++
          removeEventListener(type, listener, options)
        }

        const app = document.querySelector('#app').__vue_app__
        const store = app.config.globalProperties.$store
        app._context.directives['overlay-scrollbars'].mounted(viewport, { value: true })
        const afterDefaultSetup = { ...counts }
        store.commit('setScrollSpeed', 200)
        const afterCustomSpeed = { ...counts }
        store.commit('setScrollSpeed', 100)

        return { afterDefaultSetup, afterCustomSpeed, afterReset: counts }
      })

      expect(listenerCounts).toEqual({
        afterDefaultSetup: { added: 0, removed: 0 },
        afterCustomSpeed: { added: 1, removed: 0 },
        afterReset: { added: 1, removed: 1 },
      })
    })

    test('bubbles scaled wheel input from a nested boundary to the page', async ({ page }) => {
      await addPageOverflow(page)
      const viewport = await addNestedCustomSpeedScroller(
        page,
        'data-scroll-speed-bubble-test',
        200
      )
      await page.evaluate(() => {
        window.scrollTo(0, 0)
        document.addEventListener('wheel', (event) => {
          window.__scrollSpeedBubbleTestDelta = event.deltaY
        }, { capture: true, once: true })
      })

      await viewport.hover()
      await page.mouse.wheel(0, 120)

      await expect.poll(() => page.evaluate(() => (
        window.__scrollSpeedBubbleTestDelta > 0 &&
        window.scrollY === window.__scrollSpeedBubbleTestDelta * 2
      ))).toBe(true)
    })

    test('hands a wheel burst to the page at a pending nested boundary', async ({ page }) => {
      await addPageOverflow(page)
      const viewport = await addNestedCustomSpeedScroller(
        page,
        'data-scroll-speed-burst-boundary-test',
        150
      )
      await viewport.evaluate((element) => {
        window.scrollTo(0, 0)

        for (let index = 0; index < 2; index++) {
          element.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY: 50,
          }))
        }
      })

      await expect.poll(async () => ({
        page: await page.evaluate(() => window.scrollY),
        viewport: await viewport.evaluate((element) => element.scrollTop),
      }), { timeout: 2000 }).toEqual({ page: 100, viewport: 200 })
    })

    test('reverses a pending scroll after the content shrinks', async ({ page }) => {
      const viewport = await addNestedCustomSpeedScroller(
        page,
        'data-scroll-speed-shrink-test',
        100
      )
      await viewport.evaluate((element) => {
        element.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 50,
        }))
        element.firstElementChild.style.height = '200px'
        element.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: -25,
        }))
      })

      await expect.poll(() => viewport.evaluate(
        (element) => element.scrollTop
      )).toBe(50)
    })

    test('reconciles an end position after the viewport grows', async ({ page }) => {
      await page.evaluate(() => {
        const viewport = document.createElement('div')
        viewport.dataset.resizeScrollbarTest = ''
        Object.assign(viewport.style, {
          height: '80px',
          overflowY: 'auto',
          position: 'fixed',
          transition: 'height 250ms linear',
          width: '200px',
        })

        const content = document.createElement('div')
        content.style.height = '240px'
        viewport.append(content)
        document.body.append(viewport)

        const app = document.querySelector('#app').__vue_app__
        app._context.directives['overlay-scrollbars'].mounted(viewport, { value: true })
        viewport.scrollTop = viewport.scrollHeight
      })

      const viewport = page.locator('[data-resize-scrollbar-test]')
      await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      await viewport.evaluate((element) => { element.style.height = '300px' })

      await expect.poll(() => viewport.evaluate((element) => {
        const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
        return {
          hasVisibleScrollbar: scrollbar.classList.contains('os-scrollbar-visible'),
          scrollTop: element.scrollTop,
        }
      })).toEqual({
        hasVisibleScrollbar: false,
        scrollTop: 0,
      })
    })
  })

  test('the handle is as wide as the configured thumb width', async ({ page }) => {
    await addPageOverflow(page)
    const handle = page.locator(`${PAGE_SCROLLBAR} .os-scrollbar-handle`)
    await page.mouse.wheel(0, 300)

    expect(await handle.evaluate((element) => element.clientWidth)).toBe(6)

    const themeSection = await goToSettingsSection(page, 'appearance')
    const slider = themeSection.getByRole('slider', { name: /Scrollbar Width/ })
    await slider.focus()
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('ArrowRight')
    }

    const width = Number(await slider.inputValue())
    expect(width).toBeGreaterThan(6)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('.settingsWindow')).toBeHidden()

    // A wider thumb rests at the default width so it doesn't cover content,
    // and only grows to the configured width once the pointer is on it.
    await page.mouse.move(800, 400)
    await expect.poll(() => handle.evaluate((element) => element.clientWidth)).toBe(6)
    await handle.hover()
    await expect.poll(() => handle.evaluate((element) => element.clientWidth)).toBe(width)
  })

  test('turning "Always Show Scrollbars" on keeps them visible while idle', async ({ page, attachScreenshot }) => {
    await addPageOverflow(page)
    const scrollbar = page.locator(PAGE_SCROLLBAR)

    const themeSection = await goToSettingsSection(page, 'appearance')
    // Opening Settings uses controls at the top of the page and can scroll
    // them into view. Establish the position that the rebuild must preserve
    // only after the settings window is open.
    await page.evaluate(() => window.scrollTo(0, 300))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300)
    const toggle = themeSection.getByRole('checkbox', { name: 'Always Show Scrollbars' })
    await expect(toggle).not.toBeChecked()
    // The styled label covers the checkbox input, so click that instead.
    await themeSection.locator('label.switch-label').filter({ hasText: 'Always Show Scrollbars' }).click()
    await expect(toggle).toBeChecked()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(250)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('.settingsWindow')).toBeHidden()

    // The switch takes effect on the scrollbars that already exist, and
    // rebuilding them mustn't lose where the page was scrolled to.
    await page.mouse.move(400, 700)
    // Idle well past the 1300ms auto hide delay.
    await page.waitForTimeout(2500)

    await expect(scrollbar).toBeVisible()
    await attachScreenshot('scrollbar still visible while idle')
    await expect(scrollbar).toHaveCSS('opacity', '1')
    // Roughly, not exactly: flipping the switch also reflows the settings page
    // a little by revealing the "changed setting" indicator.
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(250)
  })
})

test.describe('overlay scrollbars with smooth scrolling disabled', () => {
  test.use({ seed: { settings: { disableSmoothScrolling: true } } })

  test('keeps custom-speed wheel scrolling immediate', async ({ page }) => {
    await recordCustomSpeedPageScroll(page)

    await page.mouse.move(800, 400)
    await page.mouse.wheel(0, 120)

    await expect.poll(() => page.evaluate(
      () => window.__scrollSpeedAnimationPositions
    )).toEqual([240])
  })
})
