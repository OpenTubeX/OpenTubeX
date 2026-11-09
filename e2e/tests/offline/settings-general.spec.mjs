import {
  test,
  expect,
  goTo,
  goToSettingsSection,
  latestSettings,
  sel,
  readDatastore,
} from '../../helpers/app.mjs'

test.describe('Invidious instance list refresh', () => {
  /** Resolves with a function that answers the held instance list request. */
  let listRequested

  test.use({
    seed: { settings: { backendPreference: 'invidious' } },
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a fixture object
    onPhase: async ({}, use) => use(async (phase, _page, electronApp) => {
      if (phase !== 'electronConnected') return
      let requested
      listRequested = new Promise(resolve => { requested = resolve })
      await electronApp.context().route('https://api.invidious.io/instances.json', route => {
        requested(json => route.fulfill({ json }))
      })
    })
  })

  test('keeps an instance chosen while the list was loading', async ({ page }) => {
    const fulfill = await listRequested
    await page.evaluate(() => window.$store.commit('setCurrentInvidiousInstance', 'https://chosen.invidious.test'))
    const refreshed = 'https://refreshed.invidious.test'
    fulfill([['refreshed.invidious.test', { api: true, cors: true, uri: refreshed }]])
    await expect.poll(() => page.evaluate(() => window.$store.getters.getInvidiousInstancesList)).toEqual([refreshed])
    expect(await page.evaluate(() => window.$store.getters.getCurrentInvidiousInstance)).toBe('https://chosen.invidious.test')
  })
})

test.describe('Invidious instance list without Invidious API use', () => {
  let listRequests = 0
  const refreshed = 'https://refreshed.invidious.test'

  test.use({
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a fixture object
    onPhase: async ({}, use) => use(async (phase, _page, electronApp) => {
      if (phase !== 'electronConnected') return
      listRequests = 0
      await electronApp.context().route('https://api.invidious.io/instances.json', route => {
        listRequests++
        return route.fulfill({ json: [['refreshed.invidious.test', { api: true, cors: true, uri: refreshed }]] })
      })
    })
  })

  test('does not contact api.invidious.io when only the local API is used', async ({ page }) => {
    // The list would be requested right after startup picks a random instance.
    await expect.poll(() => page.evaluate(() => window.$store.getters.getCurrentInvidiousInstance)).not.toBe('')
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)))
    expect(listRequests).toBe(0)
  })

  test('fetches the list once Invidious is selected without a restart', async ({ page }) => {
    await expect.poll(() => page.evaluate(() => window.$store.getters.getCurrentInvidiousInstance)).not.toBe('')
    await page.evaluate(() => window.$store.dispatch('updateBackendPreference', 'invidious'))
    await expect.poll(() => page.evaluate(() => window.$store.getters.getCurrentInvidiousInstance)).toBe(refreshed)
    await page.evaluate(() => window.$store.dispatch('updateBackendFallback', true))
    await page.evaluate(() => window.$store.dispatch('updateBackendPreference', 'local'))
    expect(listRequests).toBe(1)
  })
})

test.describe('settings', () => {
  test('the vertical tab height slider only becomes usable with vertical tabs', { tag: '@scale' }, async ({ app, page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const slider = page.getByRole('slider', { name: /Vertical Tab Height/ })
    await expect(slider).toBeDisabled()

    await page.evaluate(() => window.$store.dispatch('updateTabBarPosition', 'right'))
    await expect(slider).toBeEnabled()

    // Dragging resizes the tabs live and saves the value on release.
    await slider.evaluate((input) => {
      input.value = '40'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect.poll(() => page.locator(sel.activeTab).evaluate(
      tab => Math.round(tab.getBoundingClientRect().height)
    )).toBe(40)
    await slider.evaluate(input => input.dispatchEvent(new Event('change', { bubbles: true })))
    await expect.poll(() => latestSettings(
      readDatastore(app.userDataDir, 'settings')
    ).verticalTabHeight).toBe(40)
  })

  test('keeps the settings scrollbar stationary while dragging animation speed', { tag: '@scale' }, async ({ page }) => {
    await page.evaluate(() => window.$store.dispatch('updateAnimationSpeed', 50))
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    const slider = page.getByRole('slider', { name: /Animation Speed/ })
    await slider.scrollIntoViewIfNeeded()
    const content = page.locator('.settingsContent')
    const measure = () => content.evaluate(element => {
      const handle = element.querySelector('.os-scrollbar-vertical .os-scrollbar-handle')
      return {
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        thumbTop: handle.getBoundingClientRect().top,
        thumbHeight: handle.getBoundingClientRect().height
      }
    })
    // OverlayScrollbars positions the thumb after the scroll event, so let it settle before taking the baseline.
    await expect.poll(async () => {
      const first = await measure()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const second = await measure()
      return Math.abs(second.thumbTop - first.thumbTop) + Math.abs(second.scrollTop - first.scrollTop)
    }).toBe(0)
    const box = await slider.boundingBox()
    expect(box, 'Animation Speed slider must be visible before dragging').not.toBeNull()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    const before = await measure()
    const initialValue = await slider.inputValue()
    try {
      for (const fraction of [0.1, 0.9, 0.3, 0.7]) {
        await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 12 })
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const after = await measure()
        expect(after.scrollTop).toBeCloseTo(before.scrollTop, 0)
        expect(after.scrollHeight).toBe(before.scrollHeight)
        expect(Math.abs(after.thumbTop - before.thumbTop)).toBeLessThanOrEqual(1)
        expect(Math.abs(after.thumbHeight - before.thumbHeight)).toBeLessThanOrEqual(1)
      }
      expect(await slider.inputValue()).not.toBe(initialValue)
    } finally {
      await page.mouse.up()
    }

    // A changed timeline rate can also leave the thumb at the wrong
    // position on subsequent scrolling, even if the drag looked stable.
    await content.evaluate(element => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
    })
    await expect.poll(() => content.evaluate(element => {
      const track = element.querySelector('.os-scrollbar-vertical .os-scrollbar-track').getBoundingClientRect()
      const thumb = element.querySelector('.os-scrollbar-vertical .os-scrollbar-handle').getBoundingClientRect()
      const progress = element.scrollTop / (element.scrollHeight - element.clientHeight)
      return Math.abs(thumb.top - track.top - (track.height - thumb.height) * progress)
    })).toBeLessThanOrEqual(1)
  })

  test('keeps the watched progress mode when history is toggled', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="privacy"]').click()

    const rememberHistoryLabel = page.locator('label.switch-label')
      .filter({ hasText: 'Remember Watch History' })
    const rememberHistory = page.getByRole('checkbox', { name: 'Remember Watch History' })
    const watchedProgressMode = page.locator('.select')
      .filter({ hasText: 'Save Watched Progress' })
      .locator('select')

    await expect(rememberHistory).toBeChecked()
    await watchedProgressMode.selectOption('semi-auto')
    await rememberHistoryLabel.click()
    await expect(rememberHistory).not.toBeChecked()
    await expect(watchedProgressMode).toHaveValue('semi-auto')

    await rememberHistoryLabel.click()
    await expect(rememberHistory).toBeChecked()
    await expect(watchedProgressMode).toHaveValue('semi-auto')
  })

  test('switches icon packs from Theme settings and persists the choice', async ({ page, attachScreenshot }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const iconPackSetting = page.locator('.select').filter({ hasText: 'Icon Pack' })
    const select = iconPackSetting.locator('select')
    await expect(select).toHaveValue('material')
    await expect(page.locator(
      '.settingsMenu [data-section="add-ons"] [data-icon="puzzle-piece"][data-icon-pack="material"]'
    )).toBeVisible()
    await expect(page.locator(
      '.settingsMenu [data-section="data"] [data-icon="box-archive"][data-icon-pack="material"]'
    )).toBeVisible()
    await attachScreenshot('material icon pack')
    await select.selectOption('remix')
    await expect(page.locator('[data-icon-pack="remix"]').first()).toBeVisible()
    await expect(page.locator(
      '.settingsMenu [data-section="add-ons"] [data-icon="puzzle-piece"][data-icon-pack="remix"]'
    )).toBeVisible()
    await expect(page.locator(
      '.settingsMenu [data-section="data"] [data-icon="box-archive"][data-icon-pack="remix"]'
    )).toBeVisible()
    await attachScreenshot('remix icon pack')

    await page.reload()
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    await expect(iconPackSetting.locator('select')).toHaveValue('remix')
    await expect(page.locator('[data-icon-pack="remix"]').first()).toBeVisible()
  })

  test('keeps the current icon pack when another pack fails to load', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.evaluate(() => {
      const appendChild = document.head.appendChild.bind(document.head)
      document.head.appendChild = element => {
        if (element instanceof HTMLScriptElement) {
          queueMicrotask(() => element.dispatchEvent(new Event('error')))
          return element
        }
        return appendChild(element)
      }
    })

    const select = page.locator('.select').filter({ hasText: 'Icon Pack' }).locator('select')
    const loadFailure = page.waitForEvent('console', message => (
      message.type() === 'error' && message.text().includes('[icon-pack] failed to load remix')
    ))
    await select.selectOption('remix')
    await loadFailure
    expect(errors).toEqual([])
    await expect(select).toHaveValue('material')

    await page.reload()
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    await expect(select).toHaveValue('material')
  })

  test('a toggled setting persists across restarts', async ({ app }) => {
    let page = app.page
    await goTo(page, 'settings')

    const toggle = page.getByRole('checkbox', { name: 'Check for Updates' })
    await expect(toggle).not.toBeChecked()
    // The styled label covers the checkbox input, so click that instead.
    await page.locator('label.switch-label').filter({ hasText: 'Check for Updates' }).click()
    await expect(toggle).toBeChecked()
    await expect.poll(async () => latestSettings(
      readDatastore(app.userDataDir, 'settings')
    ).checkForUpdates).toBe(true)

    ;({ page } = await app.relaunch())
    await goTo(page, 'settings')
    await expect(page.getByRole('checkbox', { name: 'Check for Updates' })).toBeChecked()
  })
})

test.describe('invalid icon pack', () => {
  test.use({ seed: { settings: { iconPack: 'unsupported' } } })

  test('normalizes the stored value to the applied fallback', async ({ app, page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const iconPack = page.locator('[data-section="appearance"] .select')
      .filter({ hasText: 'Icon Pack' })
      .locator('select')
    await expect(iconPack).toHaveValue('material')
    await expect(page.locator('[data-icon-pack="material"]').first()).toBeVisible()
    await expect.poll(async () => {
      return latestSettings(
        readDatastore(app.userDataDir, 'settings')
      ).iconPack
    }).toBe('material')
  })
})

test.describe('subscription settings horizontal layout', { tag: '@scale' }, () => {
  test.use({ seed: { settings: { reducedMotion: 'on', alwaysShowScrollbars: true } } })

  test('fits all subscription controls across window widths without horizontal scrolling', async ({ app, page, uiScale }) => {
    await goToSettingsSection(page, 'subscription')
    await page.getByRole('button', { name: 'Maximize', exact: true }).click()
    const content = page.locator('.settingsContent')
    for (const width of [1100, 1000, 900, 820, 740, 680, 500, 375, 1100]) {
      await content.evaluate(element => { element.scrollTop = element.scrollHeight })
      await app.electronApp.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setBounds({ ...window.getBounds(), ...size })
      }, { width: Math.round(width * uiScale / 100), height: 750 * uiScale / 100 })
      // Scaled window bounds round to whole device pixels.
      await expect.poll(() => page.evaluate(width => Math.abs(window.innerWidth - width), width)).toBeLessThanOrEqual(1)
      await expect.poll(() => content.evaluate(element => element.scrollWidth - element.clientWidth), { message: `subscriptions fit at ${width}px` }).toBeLessThanOrEqual(1)
      await expect(content.locator('.os-scrollbar-horizontal')).toHaveClass(/os-scrollbar-unusable/)
      await expect(content).toHaveJSProperty('scrollLeft', 0)
      await expect.poll(() => content.evaluate(element => {
        const section = element.querySelector('.section')
        const contentEnd = section.getBoundingClientRect().bottom - element.getBoundingClientRect().top +
            element.scrollTop + Number.parseFloat(getComputedStyle(element).paddingBottom)
        const maximum = Math.max(0, contentEnd - element.clientHeight)
        const scrollbar = element.querySelector('.os-scrollbar-vertical')
        if (maximum <= 1) return element.scrollTop <= 1 && scrollbar.classList.contains('os-scrollbar-unusable')
        const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
        const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
        return element.scrollTop <= maximum + 1 &&
            Math.abs(thumb.height / track.height - element.clientHeight / element.scrollHeight) < 0.02
      })).toBe(true)
      const controls = content.locator('.switch-ctn, .select, .pure-material-slider, .manageButton')
      expect(await controls.evaluateAll(elements => elements.every(control => {
        const bounds = control.getBoundingClientRect()
        const viewport = control.closest('.settingsContent').getBoundingClientRect()
        return bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1
      }))).toBe(true)
    }
  })

  test('clears a horizontal offset when switching settings categories', async ({ page }) => {
    const section = await goToSettingsSection(page, 'subscription')
    const content = page.locator('.settingsContent')
    // Keep the previous overflow range alive until the category switch. This
    // reproduces Chromium retaining a horizontal offset after content changes.
    await section.evaluate(element => { element.style.minWidth = '1500px' })
    await content.evaluate(element => { element.scrollLeft = element.scrollWidth })
    await expect.poll(() => content.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    await page.locator('.settingsMenu [data-section="privacy"]').click()
    await expect.poll(() => content.evaluate(element => element.scrollLeft)).toBe(0)
    await expect.poll(() => content.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await expect(content.locator('.os-scrollbar-horizontal')).toHaveClass(/os-scrollbar-unusable/)
  })
})
