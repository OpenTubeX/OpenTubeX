import { DBActions, IpcChannels } from '../../../src/constants.js'
import { chooseSelectOption, test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

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

    await expect(positionSelect).toHaveValue('bottom-center')
    await expect(holder).toHaveClass(/position-bottom-center/)

    const dismissDragDistance = 120

    await chooseSelectOption(positionSelect, 'bottom-left')
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

    await chooseSelectOption(positionSelect, 'bottom-center')
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

    await chooseSelectOption(positionSelect, 'bottom-right')
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

    await chooseSelectOption(positionSelect, 'top-left')
    await expect(holder).toHaveClass(/position-top-left/)
    toast = await showToast('Top left toast')
    bounds = await toast.boundingBox()
    expect(bounds.x).toBeLessThan(50)
    // Below the horizontal tab bar
    const tabBar = await page.locator('.tabBar').boundingBox()
    await expectToastInset(toast, 'top', tabBar.y + tabBar.height + 29)
    await dragToast(toast, -dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await chooseSelectOption(positionSelect, 'top-center')
    await expect(holder).toHaveClass(/position-top-center/)
    toast = await showToast('Top center toast')
    bounds = await toast.boundingBox()
    viewport = await viewportSize()
    expect(bounds.x + bounds.width / 2).toBeCloseTo(viewport.width / 2, 0)
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await chooseSelectOption(positionSelect, 'bottom-right')
    await chooseSelectOption(positionSelect, 'top-right')
    await expect(holder).toHaveClass(/position-top-right/)
    toast = await showToast('Top right toast')
    bounds = await toast.boundingBox()
    viewport = await viewportSize()
    expect(bounds.x + bounds.width).toBeGreaterThan(viewport.width - 50)
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)
  })

  test('keeps a reset after position changes made during a pending save', async ({ app, page }) => {
    await page.evaluate(() => window.$store.dispatch('updateToastPosition', 'top-left'))
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    const setting = page.locator('[data-section="appearance"] .select').filter({ hasText: 'Toast Position' })
    const select = setting.locator('select')
    await app.electronApp.evaluate(({ ipcMain }, { channel, upsert }) => {
      const original = ipcMain._invokeHandlers.get(channel)
      let holdNextWrite = true
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, request) => {
        if (holdNextWrite && request.action === upsert && request.data?._id === 'toastPosition') {
          holdNextWrite = false
          await new Promise(resolve => { globalThis.__releaseToastPositionSave = resolve })
        }
        return original(event, request)
      })
    }, { channel: IpcChannels.DB_SETTINGS, upsert: DBActions.GENERAL.UPSERT })
    await page.evaluate(() => {
      window.__toastPositionUpdatesFinished = 0
      window.$store.subscribeAction({
        after(action) {
          if (action.type === 'updateToastPosition') window.__toastPositionUpdatesFinished++
        }
      })
    })

    await chooseSelectOption(select, 'top-right')
    await expect.poll(() => app.electronApp.evaluate(() =>
      typeof globalThis.__releaseToastPositionSave === 'function'
    )).toBe(true)
    try {
      await chooseSelectOption(select, 'bottom-right')
      await setting.getByRole('button', { name: 'Reset this setting to its default' }).click()
    } finally {
      await app.electronApp.evaluate(() => globalThis.__releaseToastPositionSave())
    }
    await expect.poll(() => page.evaluate(() => window.__toastPositionUpdatesFinished)).toBe(3)
    await expect(select).toHaveValue('bottom-center')
    await expect(setting.getByRole('button', { name: 'Reset this setting to its default' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Test toast', exact: true }).click()
    await expect(page.locator('.toast-holder')).toHaveClass(/position-bottom-center/)
    await expect(page.locator('.toast', { hasText: 'Test toast' })).toBeVisible()
  })

  test('only shows important notifications when enabled', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const appearanceSection = page.locator('[data-section="appearance"]')
    const importantToggle = appearanceSection.getByRole('checkbox', { name: 'Only show important notifications' })
    const importantLabel = appearanceSection.locator('.switch-label', { hasText: 'Only show important notifications' })
    const progressToggle = appearanceSection.getByRole('checkbox', { name: 'Show progress as notification' })
    await expect(importantToggle).not.toBeChecked()
    await expect(progressToggle).toBeEnabled()
    await expect(progressToggle).toBeChecked()

    await importantLabel.click()
    await expect(importantToggle).toBeChecked()
    // Progress moves to the progress bar, so the toggle shows the effective state
    await expect(progressToggle).toBeDisabled()
    await expect(progressToggle).not.toBeChecked()

    const holder = page.locator('.toast-holder')
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Routine toast', 10000, ['fas', 'check'])
      window.ftElectron.showToastOnAllTabs('Error toast', 10000, ['fas', 'circle-exclamation'])
      window.ftElectron.showToastOnAllTabs('Warning toast', 10000, ['fas', 'triangle-exclamation'])
      window.ftElectron.showToastOnAllTabs('Action toast', 10000, null, 'open-sync-settings')
    })
    await expect(holder.locator('.toast', { hasText: 'Action toast' })).toBeVisible()
    await expect(holder.locator('.toast', { hasText: 'Error toast' })).toBeVisible()
    await expect(holder.locator('.toast', { hasText: 'Warning toast' })).toBeVisible()
    await expect(holder.locator('.toast', { hasText: 'Routine toast' })).toHaveCount(0)

    // Testing the toast position must work regardless
    await appearanceSection.getByRole('button', { name: 'Test toast' }).click()
    await expect(holder.locator('.toast', { hasText: 'Test toast' })).toBeVisible()

    await importantLabel.click()
    await expect(importantToggle).not.toBeChecked()
    await expect(progressToggle).toBeEnabled()
    await expect(progressToggle).toBeChecked()
    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Routine toast again', 10000, ['fas', 'check'])
    })
    await expect(holder.locator('.toast', { hasText: 'Routine toast again' })).toBeVisible()
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
      await chooseSelectOption(positionSelect, 'bottom-left')
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
      await chooseSelectOption(positionSelect, 'top-right')
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
      store.commit('addProgressOperation', { id: 'e2e', icon: ['fas', 'sync'], message: 'Phone progress toast', percentage: 50 })
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

    const layoutSection = page.locator('[data-section="appearance"] .settingsSection')
      .filter({ has: page.getByRole('heading', { name: 'Layout', exact: true }) })
    const toastPositionRow = layoutSection.locator('.themeSelectRow')
      .filter({ hasText: 'Toast Position' })
    await chooseSelectOption(toastPositionRow.locator('.select')
      .filter({ hasText: 'Toast Position' })
      .locator('select'), 'top-left')
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
})
