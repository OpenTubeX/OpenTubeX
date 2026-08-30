import { test, expect, goToSettingsSection, sel } from '../../helpers/app.mjs'

// The page's own scrollbars are the ones appended to the body.
const PAGE_SCROLLBAR = 'body > .os-scrollbar-vertical'

/** The assertions below only mean anything once there is something to scroll. */
const pageOverflows = (page) => page.evaluate(
  () => document.documentElement.scrollHeight > window.innerHeight
)

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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setScrollSpeed', 200)

      for (const deltaY of [120, -120]) {
        document.body.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY,
        }))
      }
    })

    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('the page scrollbar stays on the content side of right vertical tabs', async ({ page }) => {
    await addPageOverflow(page)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setVerticalTabBarWidth', 220)
      store.commit('setTabBarPosition', 'left')
    })

    await expect(page.locator('.tabBar.position-left')).toBeVisible()
    const scrollbarBox = await page.locator(PAGE_SCROLLBAR).boundingBox()
    const innerWidth = await page.evaluate(() => window.innerWidth)

    expect(Math.abs(scrollbarBox.x + scrollbarBox.width - innerWidth)).toBeLessThanOrEqual(1)
  })

  test('keeps the quick settings avatar clear of a wide page scrollbar', async ({ page }) => {
    await addPageOverflow(page)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setScrollbarThumbWidth', 20)
    })

    for (const zoomFactor of [1, 1.25]) {
      await page.evaluate((factor) => window.ftElectron.setZoomFactor(factor), zoomFactor)
      await expect.poll(async () => {
        const [avatarBox, scrollbarBox] = await Promise.all([
          page.locator('.topNav .profileTrigger').boundingBox(),
          page.locator(PAGE_SCROLLBAR).boundingBox()
        ])
        return scrollbarBox.x - (avatarBox.x + avatarBox.width)
      }).toBeGreaterThanOrEqual(5)
    }

    await page.evaluate(() => window.ftElectron.setZoomFactor(1))
    await page.setViewportSize({ width: 400, height: 720 })
    await page.locator('.topNav .profileTrigger').click()
    const menuBox = await page.locator('.quickSettingsMenu').boundingBox()

    expect(menuBox.x).toBeGreaterThanOrEqual(0)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(400)
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

  test('clicking the track jumps to that position', async ({ page }) => {
    await addPageOverflow(page)
    // Otherwise there is nothing to scroll and the assertion below would fail
    // whether or not click scrolling works.
    expect(await page.evaluate(() => window.scrollY)).toBe(0)

    // Needs the ClickScrollPlugin to be registered; without it the library
    // ignores clickScroll and the track does nothing.
    const track = page.locator(`${PAGE_SCROLLBAR} .os-scrollbar-track`)
    const box = await track.boundingBox()

    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20)
    await page.mouse.down()
    await page.mouse.up()

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  })

  test('dragging the page handle scrolls the document', async ({ page }) => {
    await addPageOverflow(page)

    const handle = page.locator(`${PAGE_SCROLLBAR} .os-scrollbar-handle`)
    await handle.hover()
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 100, { steps: 10 })
    await page.mouse.up()

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  })

  test('keeps the page handle under the pointer when content loads during a drag', async ({ page }) => {
    await addPageOverflow(page)

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
