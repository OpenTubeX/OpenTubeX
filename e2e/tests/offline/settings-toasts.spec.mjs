import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

async function waitForToastsToSettle(page) {
  await expect.poll(() => page.locator('.toast-holder').evaluate(async holder => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return [...holder.querySelectorAll('[data-sonner-toast]')].every(row => row.dataset.mounted === 'true') &&
      !holder.getAnimations({ subtree: true }).some(animation => animation instanceof CSSTransition)
  })).toBe(true)
}

test.describe('settings', () => {
  test('positions toasts and dismisses them towards the configured edge', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const themeSection = page.locator('[data-section="appearance"]')
    const positionSelect = themeSection.locator('.select')
      .filter({ hasText: 'Toast Position' })
      .locator('select')
    const holder = page.locator('.toast-holder')

    async function showToast (message) {
      await page.evaluate((text) => {
        window.ftElectron.showToastOnAllTabs(text, 10000)
      }, message)

      const toast = holder.locator('.toast', { hasText: message })
      await expect(toast).toBeVisible()
      await expect(toast).toHaveCSS('transform', 'none')
      await expect(toast.locator('..')).toHaveCSS('transform', 'none')
      // The drain waits out the enter transition and then uses up the rest of
      // the toast's lifetime, so it empties just as the toast is dismissed
      await expect(
        toast.locator('..').locator('.timeout-indicator .embeddedProgressPath')
      ).toHaveCSS('animation-duration', '9.7s')
      await expect(
        toast.locator('..').locator('.timeout-indicator .embeddedProgressPath')
      ).toHaveCSS('animation-delay', '0.3s')
      // The row a toast sits in slides it into place, so let that settle before
      // anything measures where the toast ended up
      await waitForToastsToSettle(page)
      return toast
    }

    async function expectToastInset (toast, edge, inset) {
      const bounds = await toast.boundingBox()
      const viewport = await viewportSize()

      if (edge === 'top') {
        expect(bounds.y).toBeCloseTo(inset, 0)
      } else {
        expect(viewport.height - (bounds.y + bounds.height)).toBeCloseTo(inset, 0)
      }
    }

    async function dragToast (toast, distance) {
      const bounds = await toast.boundingBox()
      const x = distance < 0
        ? bounds.x + bounds.width - 5
        : bounds.x + 5
      const y = bounds.y + bounds.height / 2

      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + distance, y, { steps: 5 })

      // The timeout indicator has to follow the toast as it is dragged
      const indicatorTrack = toast.locator('..').locator('.timeout-indicator-track')
      const [draggedBounds, indicatorBounds] = await Promise.all([
        toast.boundingBox(),
        indicatorTrack.boundingBox()
      ])
      expect(indicatorBounds.x).toBeCloseTo(draggedBounds.x, 0)
      expect(indicatorBounds.y).toBeCloseTo(draggedBounds.y, 0)

      // A drag is dismissed on distance or on speed, so hold still for a moment
      // to keep these deliberate drags out of the flick-to-dismiss range
      await page.waitForTimeout(300)
    }

    function viewportSize () {
      return page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight
      }))
    }

    const dismissDragDistance = 120

    await positionSelect.selectOption('bottom-left')
    await expect(holder).toHaveClass(/position-bottom-left/)
    let toast = await showToast('Left toast')
    let bounds = await toast.boundingBox()
    expect(bounds.x).toBeLessThan(50)
    await expectToastInset(toast, 'bottom', 29)
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toBeVisible()
    await expect.poll(async () => (await toast.boundingBox()).x).toBeCloseTo(bounds.x, 0)
    await dragToast(toast, -dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('bottom-center')
    await expect(holder).toHaveClass(/position-bottom-center/)
    toast = await showToast('Center toast dragged left')
    bounds = await toast.boundingBox()
    let viewport = await viewportSize()
    expect(bounds.x + bounds.width / 2).toBeCloseTo(viewport.width / 2, 0)
    await dragToast(toast, -dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    toast = await showToast('Center toast dragged right')
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('bottom-right')
    await expect(holder).toHaveClass(/position-bottom-right/)
    toast = await showToast('Right toast')
    bounds = await toast.boundingBox()
    viewport = await viewportSize()
    expect(bounds.x + bounds.width).toBeGreaterThan(viewport.width - 50)
    await dragToast(toast, -dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toBeVisible()
    await expect.poll(async () => (await toast.boundingBox()).x).toBeCloseTo(bounds.x, 0)
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('top-left')
    await expect(holder).toHaveClass(/position-top-left/)
    toast = await showToast('Top left toast')
    bounds = await toast.boundingBox()
    expect(bounds.x).toBeLessThan(50)
    // Below the horizontal tab bar
    await expectToastInset(toast, 'top', 61)
    await dragToast(toast, -dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('top-center')
    await expect(holder).toHaveClass(/position-top-center/)
    toast = await showToast('Top center toast')
    bounds = await toast.boundingBox()
    viewport = await viewportSize()
    expect(bounds.x + bounds.width / 2).toBeCloseTo(viewport.width / 2, 0)
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('bottom-right')
    await positionSelect.selectOption('top-right')
    await expect(holder).toHaveClass(/position-top-right/)
    toast = await showToast('Top right toast')
    bounds = await toast.boundingBox()
    viewport = await viewportSize()
    expect(bounds.x + bounds.width).toBeGreaterThan(viewport.width - 50)
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)
  })

  test('shows a test toast from the toast position setting', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const themeSection = page.locator('[data-section="appearance"]')
    const toastPositionRow = themeSection.locator('.themeSelectRow')
      .filter({ hasText: 'Toast Position' })
    const positionSelect = toastPositionRow.locator('.select')
      .filter({ hasText: 'Toast Position' })
      .locator('select')
    const holder = page.locator('.toast-holder')

    await positionSelect.selectOption('top-right')
    await toastPositionRow.getByRole('button', { name: 'Test toast' }).click()

    await expect(holder).toHaveClass(/position-top-right/)
    await expect(holder.locator('.toast', { hasText: 'Test toast' })).toBeVisible()
  })

  test('honors the configured toast position on Android phones', async ({ app, page }) => {
    const phoneSafeArea = { top: 24, bottom: 16 }
    const layoutTolerance = 0.05
    await setWindowSize(app, page, { width: 375, height: 700 })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    await page.locator('.app').evaluate((element, safeArea) => {
      document.documentElement.style.setProperty('--safe-area-inset-top', `${safeArea.top}px`)
      document.documentElement.style.setProperty('--safe-area-inset-bottom', `${safeArea.bottom}px`)
      element.classList.remove('topTabs', 'bottomTabs', 'verticalTabs', 'verticalTabsLeft', 'verticalTabsRight')
      element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
    }, phoneSafeArea)

    const positionSelect = page.locator('[data-section="appearance"] .select')
      .filter({ hasText: 'Toast Position' })
      .locator('select')
    const holder = page.locator('.toast-holder')
    const progressToast = page.getByTestId('progress-toast')

    async function viewportSize () {
      return page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight
      }))
    }

    async function preparePhoneEdge (edge) {
      // Electron needs a non-horizontal tab position to match Capacitor's 29px
      // base inset. Keep that desktop tab on the edge opposite the one under
      // test so it cannot affect the toast's horizontal alignment.
      await page.evaluate((tabBarPosition) => {
        const store = window.$store
        store.commit('setTabBarPosition', tabBarPosition)
      }, edge === 'bottom' ? 'right' : 'left')
      await expect(holder).not.toHaveClass(/horizontal-tabs/)
      // Updating the desktop tab position also refreshes `.app`'s responsive
      // classes. Reapply the Capacitor fixture after that update has landed.
      await page.locator('.app').evaluate((element) => {
        element.classList.remove('topTabs', 'bottomTabs', 'verticalTabs', 'verticalTabsLeft', 'verticalTabsRight')
        element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
      })
      await expect(page.locator('.app')).toHaveClass(/capacitorPhoneLayout/)
      const progressBounds = await progressToast.count() === 1
        ? await progressToast.boundingBox()
        : null
      const progressInset = progressBounds ? progressBounds.height + 10 : 0
      const expectedOffset = 29 + progressInset
      // Layout rounds fractional CSS pixels differently from computed values.
      await expect.poll(() => holder.evaluate((element, { edge, expectedOffset }) => {
        const style = getComputedStyle(element)
        return Math.max(
          Math.abs(Number.parseFloat(style.getPropertyValue(`--offset-${edge}`)) - expectedOffset),
          Math.abs(Number.parseFloat(style.getPropertyValue(`--mobile-offset-${edge}`)) - expectedOffset)
        )
      }, { edge, expectedOffset })).toBeLessThan(layoutTolerance)
      return progressInset
    }

    async function expectBottomLeftToast (message) {
      await positionSelect.selectOption('bottom-left')
      await expect(holder).toHaveClass(/position-bottom-left/)
      const progressInset = await preparePhoneEdge('bottom')
      await page.evaluate((text) => {
        window.ftElectron.showToastOnAllTabs(text, 10000)
      }, message)
      const toast = page.locator('.toast', { hasText: message })
      const row = page.locator('[data-sonner-toast]', { hasText: message })
      await expect(toast).toBeVisible()
      await expect(row).toHaveAttribute('data-mounted', 'true')
      await waitForToastsToSettle(page)
      const [bounds, viewport] = await Promise.all([
        toast.boundingBox(),
        viewportSize()
      ])
      expect.soft(bounds.x).toBeLessThan(30)
      expect.soft(viewport.height - bounds.y - bounds.height)
        .toBeCloseTo(72 + phoneSafeArea.bottom + progressInset, 1)
      if (await progressToast.count() === 1) {
        const progressBounds = await progressToast.boundingBox()
        expect(bounds.y + bounds.height).toBeLessThan(progressBounds.y)
      }
      await row.focus()
      await page.keyboard.press('Escape')
      await expect(toast).toHaveCount(0)
    }

    async function expectTopRightToast (message) {
      await positionSelect.selectOption('top-right')
      await expect(holder).toHaveClass(/position-top-right/)
      const progressInset = await preparePhoneEdge('top')
      await page.evaluate((text) => {
        window.ftElectron.showToastOnAllTabs(text, 10000)
      }, message)
      const toast = page.locator('.toast', { hasText: message })
      const row = page.locator('[data-sonner-toast]', { hasText: message })
      await expect(toast).toBeVisible()
      await expect(row).toHaveAttribute('data-mounted', 'true')
      await waitForToastsToSettle(page)
      const [bounds, topNavBounds, viewport] = await Promise.all([
        toast.boundingBox(),
        page.locator('.topNav').boundingBox(),
        viewportSize()
      ])
      expect.soft(bounds.x + bounds.width).toBeGreaterThan(viewport.width - 30)
      expect.soft(bounds.y).toBeGreaterThanOrEqual(topNavBounds.y + topNavBounds.height + 12 + progressInset - layoutTolerance)
      expect.soft(bounds.y).toBeLessThan(viewport.height / 2)
      if (await progressToast.count() === 1) {
        const progressBounds = await progressToast.boundingBox()
        expect(bounds.y).toBeGreaterThan(progressBounds.y + progressBounds.height)
      }
      await row.focus()
      await page.keyboard.press('Escape')
      await expect(toast).toHaveCount(0)
    }

    await expectBottomLeftToast('Android phone bottom-left toast')
    await expectTopRightToast('Android phone top-right toast')
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(1.25, 2)
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setProgressBarMessage', 'Phone progress toast')
      store.commit('setProgressBarPercentage', 50)
      store.commit('setShowProgressBar', true)
    })
    await expect(progressToast).toBeVisible()

    await expectBottomLeftToast('Scaled Android phone bottom-left toast')
    await expectTopRightToast('Scaled Android phone top-right toast')
  })

  test('keeps top toasts below the Android tablet app header', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 375, height: 700 })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    await page.locator('.app').evaluate((app) => {
      app.classList.add('capacitorTabletLayout', 'topTabs')
      app.style.setProperty('--top-tab-bar-height', '48px')
    })

    const themeSection = page.locator('[data-section="appearance"]')
    const toastPositionRow = themeSection.locator('.themeSelectRow')
      .filter({ hasText: 'Toast Position' })
    await toastPositionRow.locator('.select')
      .filter({ hasText: 'Toast Position' })
      .locator('select')
      .selectOption('top-left')
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Earlier tablet toast', 10000)
    })
    await toastPositionRow.getByRole('button', { name: 'Test toast' }).click()

    const toast = page.locator('.toast', { hasText: 'Test toast' })
    const earlierToast = page.locator('.toast', { hasText: 'Earlier tablet toast' })
    await expect(toast).toBeVisible()
    await expect(earlierToast).toBeVisible()
    await expect(toast).toHaveCSS('transform', 'none')
    await waitForToastsToSettle(page)

    async function expectHeaderClearance() {
      const [toastBounds, earlierToastBounds, headerBounds] = await Promise.all([
        toast.boundingBox(),
        earlierToast.boundingBox(),
        page.locator('.topNav').boundingBox()
      ])
      expect(headerBounds.y).toBeCloseTo(48, 1)
      expect(headerBounds.height).toBeCloseTo(60, 1)
      const headerClearance = headerBounds.y + headerBounds.height + 12
      expect(toastBounds.y).toBeCloseTo(headerClearance, 1)
      expect(earlierToastBounds.y).toBeGreaterThanOrEqual(headerClearance)
    }

    await expectHeaderClearance()
    await setWindowSize(app, page, { width: 700, height: 375 })
    await expectHeaderClearance()
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    await expectHeaderClearance()
  })

  test('does not dismiss non-actionable toasts when clicked', async ({ page }) => {
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Swipe-only dismissal', 10000)
    })

    const toast = page.locator('.toast', { hasText: 'Swipe-only dismissal' })
    await expect(toast).toBeVisible()
    await expect(toast).not.toHaveAttribute('tabindex')

    await toast.click()
    await expect(toast).toBeVisible()

    const bounds = await toast.boundingBox()
    await page.mouse.move(bounds.x + bounds.width - 5, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x - 120, bounds.y + bounds.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect(toast).toHaveCount(0)
  })

  test('configures the toast timeout indicator and pauses toasts on hover', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const themeSection = page.locator('[data-section="appearance"]')
    const indicatorToggle = themeSection.getByRole('checkbox', { name: 'Show toast timeout indicator' })
    await expect(indicatorToggle).toBeChecked()
    await expect(themeSection.getByRole('checkbox', { name: 'Show Tab Icons' })).toBeVisible()
    await expect(page.locator('[data-section="general"]').getByRole('checkbox', {
      name: /Show (toast timeout indicator|Tab Icons)/
    })).toHaveCount(0)

    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Hover toast', 2000)
    })

    const toast = page.locator('.toast', { hasText: 'Hover toast' })
    const indicator = toast.locator('..').locator('.timeout-indicator .embeddedProgressPath')

    /**
     * Reported as a list so a failure says which animations were on the element
     * and what state they were in, instead of just "expected paused".
     */
    function indicatorStates (locator) {
      return locator.evaluate((element) => {
        return element.getAnimations().map(animation => [
          animation.animationName ?? animation.transitionProperty ?? animation.constructor.name,
          animation.playState,
        ].join(':'))
      })
    }

    await toast.hover()
    await expect.poll(() => indicatorStates(indicator)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^toast-timeout[\w-]*:paused$/),
    ]))
    // Outlast the two second lifetime while hovered
    await page.waitForTimeout(2200)
    await expect(toast).toBeVisible()

    await page.mouse.move(800, 300)
    await expect(toast).toHaveCount(0)

    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Dragged hover toast', 2000)
    })
    const draggedToast = page.locator('.toast', { hasText: 'Dragged hover toast' })
    const draggedToastBounds = await draggedToast.boundingBox()
    await page.mouse.move(
      draggedToastBounds.x + draggedToastBounds.width / 2,
      draggedToastBounds.y + draggedToastBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      draggedToastBounds.x + draggedToastBounds.width / 2 + 40,
      draggedToastBounds.y + draggedToastBounds.height / 2
    )
    await page.mouse.up()
    await page.mouse.move(800, 300)
    await expect(draggedToast).toHaveCount(0)

    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('First alternating toast', 2000)
      window.ftElectron.showToastOnAllTabs('Second alternating toast', 2000)
    })
    const firstAlternatingToast = page.locator('.toast', { hasText: 'First alternating toast' })
    const secondAlternatingToast = page.locator('.toast', { hasText: 'Second alternating toast' })
    const firstIndicator = firstAlternatingToast.locator('..').locator('.timeout-indicator .embeddedProgressPath')
    const secondIndicator = secondAlternatingToast.locator('..').locator('.timeout-indicator .embeddedProgressPath')
    await waitForToastsToSettle(page)

    // The stack is collapsed until it is hovered, so the toasts behind the front
    // one are only reachable once hovering the front one has fanned it out
    await secondAlternatingToast.hover()

    // Hovering anywhere in the stack holds every toast in it, so moving between
    // two toasts must not let either of them resume in between
    await expect.poll(() => indicatorStates(firstIndicator)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^toast-timeout[\w-]*:paused$/),
    ]))
    await firstAlternatingToast.hover()
    await page.waitForTimeout(300)
    await secondAlternatingToast.hover()
    await expect(indicatorStates(secondIndicator)).resolves.toEqual(expect.arrayContaining([
      expect.stringMatching(/^toast-timeout[\w-]*:paused$/),
    ]))

    // Both toasts outlive their two second lifetime while the stack is held
    await page.waitForTimeout(2200)
    await expect(firstAlternatingToast).toBeVisible()
    await expect(secondAlternatingToast).toBeVisible()

    await page.mouse.move(800, 300)
    await expect(firstAlternatingToast).toHaveCount(0)
    await expect(secondAlternatingToast).toHaveCount(0)

    await page.locator('label.switch-label')
      .filter({ hasText: 'Show toast timeout indicator' })
      .click()
    await expect(indicatorToggle).not.toBeChecked()

    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('No indicator toast', 2000)
    })
    const toastWithoutIndicator = page.locator('.toast', { hasText: 'No indicator toast' })
    const toastWithoutIndicatorSlot = toastWithoutIndicator.locator('..')
    await toastWithoutIndicator.hover()
    await expect(toastWithoutIndicatorSlot.locator('.timeout-indicator')).toHaveCount(0)
    // Outlast the two second lifetime while hovered
    await page.waitForTimeout(2200)
    await expect(toastWithoutIndicator).toBeVisible()

    await page.mouse.move(800, 300)
    await expect(toastWithoutIndicator).toHaveCount(0)
  })

  test('shows two toasts at a glance with the rest piled behind', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']) {
        window.ftElectron.showToastOnAllTabs(`${name} toast`, 30000)
      }
    })
    await expect(page.locator('.toast', { hasText: 'Epsilon toast' })).toBeVisible()
    await waitForToastsToSettle(page)

    function drawn () {
      return page.locator('[data-sonner-toast]').evaluateAll((rows) => {
        return rows.filter(row => getComputedStyle(row).opacity !== '0').length
      })
    }

    function readable () {
      return page.locator('.toast').evaluateAll((toasts) => {
        return toasts.filter((toast) => {
          return getComputedStyle(toast.querySelector('.message')).opacity !== '0'
        }).length
      })
    }

    // Collapsed, the two newest toasts can be read and the rest are drawn behind
    // them as cards with nothing on them, so a full stack still looks like more
    // than a couple of toasts do
    await expect.poll(readable).toBe(2)
    await expect.poll(drawn).toBe(5)

    // Each of those peeks out past the one in front of it, or the pile would be
    // hidden behind the toasts and there would be no sign of it
    const tops = await page.locator('.toast').evaluateAll((toasts) => {
      return toasts.map(toast => Math.round(toast.getBoundingClientRect().top))
    })
    expect(new Set(tops).size).toBe(tops.length)

    // They all become readable on hover
    await page.locator('.toast', { hasText: 'Epsilon toast' }).hover()
    await expect.poll(readable).toBe(5)

    await page.mouse.move(800, 300)
    await expect.poll(readable).toBe(2)
  })

  test('does not rewrap an indefinite toast while transient toasts leave the stack', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('opentubex:preview-managed-tools-update', {
        detail: ['yt-dlp', 'ffmpeg']
      }))
    })

    const updateToast = page.locator('.toast', { hasText: 'An update is available for yt-dlp and ffmpeg.' })
    const updateMessage = updateToast.locator('.message')
    await expect(updateToast).toBeVisible()
    const initialSize = await updateMessage.evaluate(element => ({
      width: element.offsetWidth,
      height: element.offsetHeight
    }))

    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('First short-lived toast', 800)
      window.ftElectron.showToastOnAllTabs('Second short-lived toast', 1000)
      window.ftElectron.showToastOnAllTabs('Third short-lived toast', 1200)
      window.ftElectron.showToastOnAllTabs('Fourth short-lived toast', 1400)
    })
    await expect(page.locator('.toast', { hasText: 'Fourth short-lived toast' })).toBeVisible()

    const sizes = await updateMessage.evaluate((element) => {
      const samples = []
      const start = performance.now()
      return new Promise((resolve) => {
        function sample () {
          samples.push({ width: element.offsetWidth, height: element.offsetHeight })
          if (performance.now() - start < 2200) {
            requestAnimationFrame(sample)
          } else {
            resolve(samples)
          }
        }
        requestAnimationFrame(sample)
      })
    })

    expect(new Set(sizes.map(({ width }) => width))).toEqual(new Set([initialSize.width]))
    expect(new Set(sizes.map(({ height }) => height))).toEqual(new Set([initialSize.height]))
    await expect(updateToast).toBeVisible()
  })

  test('keeps indefinite toast actions after the transient toast limit is exceeded', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('opentubex:preview-managed-tools-update', {
        detail: ['yt-dlp', 'ffmpeg']
      }))
      for (let index = 0; index < 8; index++) {
        window.ftElectron.showToastOnAllTabs(`Transient toast ${index}`, 600)
      }
    })

    const updateToast = page.locator('.toast', { hasText: 'An update is available for yt-dlp and ffmpeg.' })
    await expect(updateToast).toBeVisible()
    await expect(updateToast.locator('.timeout-indicator-track')).toHaveCount(0)
    await expect(updateToast).toHaveCSS('background-color', 'rgb(28, 28, 28)')

    await expect(page.locator('.toast', { hasText: 'Transient toast' })).toHaveCount(0)
    await expect(updateToast).toBeVisible()
    await updateToast.getByRole('button', { name: 'Cancel' }).click()
    await expect(updateToast).toHaveCount(0)

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('opentubex:preview-managed-tools-update', {
        detail: ['yt-dlp']
      }))
    })
    const singleToolToast = page.locator('.toast', { hasText: 'An update is available for yt-dlp.' })
    await expect(singleToolToast).toBeVisible()
    await singleToolToast.getByRole('button', { name: 'Update' }).click()
    await expect(singleToolToast).toHaveCount(0)
  })

  test('keeps the stack fanned out while the pointer moves between toasts', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      // Deliberately mismatched widths: the toasts are only as wide as their
      // message, so consecutive ones do not line up
      window.ftElectron.showToastOnAllTabs('Alpha toast that is a great deal wider than the others around it', 30000)
      window.ftElectron.showToastOnAllTabs('Beta', 30000, ['fas', 'eye'])
      window.ftElectron.showToastOnAllTabs('Gamma toast of a middling sort of width', 30000)
    })
    await expect(page.locator('.toast', { hasText: 'Gamma toast' })).toBeVisible()
    await waitForToastsToSettle(page)

    const betaToast = page.locator('.toast', { hasText: 'Beta' })
    const { trailingSpace, paddingEnd } = await betaToast.evaluate((toast) => {
      const toastBounds = toast.getBoundingClientRect()
      const messageBounds = toast.querySelector('.message').getBoundingClientRect()

      return {
        trailingSpace: toastBounds.right - messageBounds.right,
        paddingEnd: Number.parseFloat(getComputedStyle(toast).paddingInlineEnd),
      }
    })
    expect(Math.abs(trailingSpace - paddingEnd)).toBeLessThanOrEqual(1)

    const rows = page.locator('[data-sonner-toast]')
    await expect(rows.first()).toHaveAttribute('data-expanded', 'false')

    await page.locator('.toast', { hasText: 'Gamma toast' }).hover()
    await expect(rows.first()).toHaveAttribute('data-expanded', 'true')

    const centers = await page.locator('.toast').evaluateAll((elements) => {
      return elements
        .map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect()
          return { x: x + width / 2, y: y + height / 2 }
        })
        .sort((a, b) => b.y - a.y)
    })

    // Walking from one toast to the next must never drop out of the stack, or
    // it collapses under the pointer and immediately reopens
    for (let index = 1; index < centers.length; index++) {
      const from = centers[index - 1]
      const to = centers[index]

      for (let step = 1; step <= 12; step++) {
        await page.mouse.move(
          from.x + (to.x - from.x) * step / 12,
          from.y + (to.y - from.y) * step / 12
        )
        await expect(rows.first()).toHaveAttribute('data-expanded', 'true')
      }
    }

    // and it lets go once the pointer is clear of the toasts, rather than
    // holding on across the width of the window
    const widest = Math.max(...(await page.locator('.toast').evaluateAll((elements) => {
      return elements.map(element => element.getBoundingClientRect().right)
    })))
    await page.mouse.move(widest + 120, centers[0].y)
    await expect(rows.first()).toHaveAttribute('data-expanded', 'false')

    await page.mouse.move(800, 300)
    await expect(rows.first()).toHaveAttribute('data-expanded', 'false')
  })

  test('dismisses a toast with the keyboard', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Keyboard toast', 30000)
    })

    const toast = page.locator('.toast', { hasText: 'Keyboard toast' })
    await expect(toast).toBeVisible()
    await waitForToastsToSettle(page)

    // A toast without an action is not focusable itself, so the row it sits in
    // is what a user reaches, both through the toaster's hotkey and by tabbing
    await expect(toast).not.toHaveAttribute('tabindex')
    await page.locator('[data-sonner-toast]').filter({ hasText: 'Keyboard toast' }).focus()
    await page.keyboard.press('Escape')

    await expect(toast).toHaveCount(0)
  })

  test('reflows smoothly when a toast in the middle of the stack is dismissed', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Alpha toast', 30000)
      window.ftElectron.showToastOnAllTabs('Beta toast', 30000)
      window.ftElectron.showToastOnAllTabs('Gamma toast', 30000)
      window.ftElectron.showToastOnAllTabs('Delta toast', 30000)
    })
    await expect(page.locator('.toast', { hasText: 'Delta toast' })).toBeVisible()
    await waitForToastsToSettle(page)

    await page.locator('.toast', { hasText: 'Delta toast' }).hover()
    await expect(page.locator('[data-sonner-toast]').first()).toHaveAttribute('data-expanded', 'true')
    await waitForToastsToSettle(page)

    // Resting on the toast that is about to go: once it stops taking input the
    // pointer is left over nothing, which is what collapses the stack
    await page.locator('.toast', { hasText: 'Beta toast' }).hover()
    await page.waitForTimeout(200)

    const alphaStart = (await page.locator('.toast', { hasText: 'Alpha toast' }).boundingBox()).y

    // Dismiss a toast from the middle of the stack where it stands, the way one
    // that has simply run out of time goes, and follow the stack closing the gap.
    // Raised on the toast rather than driven through the keyboard, because
    // moving focus there takes the hover with it and closes the stack before the
    // dismissal lands; that a toast can be reached at all is covered on its own
    // by 'dismisses a toast with the keyboard'.
    const settling = page.evaluate(() => {
      const start = performance.now()
      const samples = []
      const unreachable = new Set()
      const collapsed = []

      const beta = [...document.querySelectorAll('.toast')].find(e => e.textContent.includes('Beta'))
      beta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

      return new Promise((resolve) => {
        function sample () {
          const toasts = [...document.querySelectorAll('.toast')]
          const alpha = toasts.find(e => e.textContent.includes('Alpha'))
          if (alpha) { samples.push([performance.now() - start, alpha.getBoundingClientRect().y]) }

          // The toast on its way out must not cover the ones staying behind: at
          // every frame each of those has to answer for its own middle
          for (const toast of toasts) {
            if (toast.closest('[data-removed="true"]')) { continue }

            const { x, y, width, height } = toast.getBoundingClientRect()
            if (!toast.contains(document.elementFromPoint(x + width / 2, y + height / 2))) {
              unreachable.add(toast.textContent.trim().split(' ')[0])
            }
          }

          // The pointer is still on the stack throughout, so it must stay
          // fanned out: collapsing and reopening around the dismissal throws
          // every remaining toast across the screen and back
          const row = document.querySelector('[data-sonner-toast]')
          if (row && row.dataset.expanded !== 'true') {
            collapsed.push(Math.round(performance.now() - start))
          }

          if (performance.now() - start < 1000) {
            requestAnimationFrame(sample)
          } else {
            resolve({ samples, unreachable: [...unreachable], collapsed })
          }
        }
        requestAnimationFrame(sample)
      })
    })

    const { samples, unreachable, collapsed } = await settling

    expect(unreachable).toEqual([])
    expect(collapsed).toEqual([])
    await expect(page.locator('.toast', { hasText: 'Beta toast' })).toHaveCount(0)

    const positions = samples.map(([, y]) => y)
    const settled = positions.at(-1)
    expect(settled).toBeGreaterThan(alphaStart)

    // The stack slides into place without springing past it and back
    expect(Math.max(...positions)).toBeCloseTo(settled, 0)

    // and it closes the gap while the dismissed toast is still animating out,
    // rather than sitting still and then shifting once it has gone
    const firstMove = samples.find(([, y]) => y > positions[0] + 1)
    expect(firstMove, 'the stack never closed the gap').toBeDefined()
    expect(firstMove[0]).toBeLessThan(200)
  })

  test('keeps the stack open when a toast is swiped out of the middle of it', async ({ page }) => {
    await page.mouse.move(800, 300)
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Alpha toast', 30000)
      window.ftElectron.showToastOnAllTabs('Beta toast', 30000)
      window.ftElectron.showToastOnAllTabs('Gamma toast', 30000)
      window.ftElectron.showToastOnAllTabs('Delta toast', 30000)
    })
    await expect(page.locator('.toast', { hasText: 'Delta toast' })).toBeVisible()
    await waitForToastsToSettle(page)

    const rows = page.locator('[data-sonner-toast]')
    await page.locator('.toast', { hasText: 'Delta toast' }).hover()
    await expect(rows.first()).toHaveAttribute('data-expanded', 'true')
    await waitForToastsToSettle(page)

    const beta = await page.locator('.toast', { hasText: 'Beta toast' }).boundingBox()
    const delta = await page.locator('.toast', { hasText: 'Delta toast' }).boundingBox()

    // Swipe the middle toast out towards the edge the stack is anchored to
    const swipeFrom = beta.x + beta.width - 10
    await page.mouse.move(swipeFrom, beta.y + beta.height / 2)
    await page.mouse.down()
    for (let step = 1; step <= 6; step++) {
      await page.mouse.move(swipeFrom - 90 * step / 6, beta.y + beta.height / 2)
    }
    await page.mouse.up()
    await expect(page.locator('.toast', { hasText: 'Beta toast' })).toHaveCount(0)

    // Only the toast that was actually swiped: a toast must never be able to
    // take a drag aimed at one of its neighbours
    await expect(page.locator('.toast', { hasText: 'Alpha toast' })).toBeVisible()
    await expect(page.locator('.toast', { hasText: 'Gamma toast' })).toBeVisible()
    await expect(page.locator('.toast', { hasText: 'Delta toast' })).toBeVisible()

    // Letting go leaves the pointer beside the stack rather than on a toast, so
    // the stack has to hold itself open until the pointer is back on one
    const from = { x: swipeFrom - 90, y: beta.y + beta.height / 2 }
    const to = { x: delta.x + delta.width / 2, y: delta.y + delta.height / 2 }
    for (let step = 1; step <= 16; step++) {
      await page.mouse.move(from.x + (to.x - from.x) * step / 16, from.y + (to.y - from.y) * step / 16)
      await expect(rows.first()).toHaveAttribute('data-expanded', 'true')
    }
  })
})

test.describe('invalid toast position', () => {
  test.use({ seed: { settings: { toastPosition: 'unsupported' } } })

  test('falls back to bottom left', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const positionSelect = page.locator('[data-section="appearance"] .select')
      .filter({ hasText: 'Toast Position' })
      .locator('select')
    await expect(positionSelect).toHaveValue('bottom-left')

    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Fallback toast', 10000)
    })

    const holder = page.locator('.toast-holder')
    await expect(holder.locator('.toast', { hasText: 'Fallback toast' })).toBeVisible()
    await expect(holder).toHaveClass(/position-bottom-left/)
  })
})
