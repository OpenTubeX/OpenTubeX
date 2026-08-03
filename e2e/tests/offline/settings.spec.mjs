import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo, latestSettings, sel, waitForAppReady } from '../../helpers/app.mjs'

test.describe('settings', () => {
  test('renders without flashing native scrollbars', async ({ page }) => {
    const renderFrames = await page.evaluate(() => {
      return new Promise((resolve) => {
        const settingsLink = Array.from(document.querySelectorAll('.sideNav a[href="#/settings"]'))
          .find(link => link instanceof HTMLElement && link.offsetParent !== null)
        const frames = []

        settingsLink.click()

        const captureFrame = () => {
          const sectionCount = document.querySelectorAll('.settingsSections > .section').length
          const menuSectionCount = document.querySelectorAll('.settingsMenu [data-section]').length
          frames.push({
            menuSectionCount,
            sectionCount,
            settingsRendered: document.querySelector('.settingsPage') !== null,
            nativeScrollbarsHidden: [document.documentElement, document.body]
              .every(element => getComputedStyle(element).scrollbarWidth === 'none'),
            pageOverlayScrollbars: Array.from(document.body.children)
              .filter(element => element.classList.contains('os-scrollbar-vertical')).length
          })

          if (menuSectionCount > 0 && sectionCount === menuSectionCount) {
            resolve(frames)
          } else {
            window.requestAnimationFrame(captureFrame)
          }
        }

        window.requestAnimationFrame(captureFrame)
      })
    })

    expect(renderFrames[0].settingsRendered).toBe(true)
    expect(renderFrames.map(({ sectionCount }) => sectionCount))
      .toEqual([1, renderFrames[0].menuSectionCount])
    expect(renderFrames.every(({ nativeScrollbarsHidden }) => nativeScrollbarsHidden)).toBe(true)
    expect(renderFrames.every(({ pageOverlayScrollbars }) => pageOverlayScrollbars === 1)).toBe(true)
  })

  test('settings page renders its sections', async ({ page }) => {
    await goTo(page, 'settings')
    await expect(page).toHaveURL(/#\/settings/)
    await expect(page.locator('.settingsMenu, .ftSettingsMenu, [class*="settings"]').first()).toBeVisible()
  })

  test('select dropdowns use overlay scrollbars', async ({ page }) => {
    await goTo(page, 'settings')

    const combobox = page.getByRole('combobox', { name: /Language preference|Locale Preference/ })
    await combobox.click()

    const dropdown = page.locator('.selectDropdown')
    await expect(dropdown).toBeVisible()
    await expect(dropdown).toContainText('English (US) (100%)')
    await expect(dropdown.locator('.os-scrollbar-vertical')).toHaveCount(1)
    await expect(dropdown).toHaveCSS('scrollbar-width', 'none')

    const appearance = await dropdown.evaluate((menu) => {
      const menuStyle = getComputedStyle(menu)
      const chromeBottom = Math.max(
        ...Array.from(document.querySelectorAll('.topNav, .tabBar:not(.vertical)'))
          .map(element => element.getBoundingClientRect().bottom)
      )

      return {
        chromeBottom,
        cursor: getComputedStyle(menu.querySelector('.selectOption')).cursor,
        fontFamily: menuStyle.fontFamily,
        menuTop: menu.getBoundingClientRect().top
      }
    })

    expect(appearance.fontFamily).toContain('Roboto')
    expect(appearance.cursor).not.toBe('pointer')
    expect(appearance.menuTop).toBeGreaterThanOrEqual(appearance.chromeBottom)

    await combobox.press('ArrowDown')
    await combobox.press('Enter')
    await expect(combobox).toContainText('English (US) (100%)')
    await expect(dropdown).toHaveCount(0)
  })

  test('retains the mounted page when switching to About and back', async ({ page }) => {
    await goTo(page, 'settings')
    const settingsPage = page.locator('.settingsPage')
    await settingsPage.evaluate(element => {
      element.dataset.cacheTest = 'mounted'
    })

    await goTo(page, 'about')
    await expect(page.locator('.about-chunks')).toBeVisible()
    await expect(settingsPage).toHaveCount(0)

    await goTo(page, 'settings')

    await expect(page.locator('.about-chunks')).toHaveCount(0)
    await expect(settingsPage).toBeVisible()
    await expect(settingsPage).toHaveAttribute('data-cache-test', 'mounted')
  })

  test('the current section persists in the URL', async ({ page }) => {
    await goTo(page, 'settings')

    const playerSectionLink = page.locator('.settingsMenu [data-section="player"]')
    await playerSectionLink.click()
    await expect(page).toHaveURL(/#\/settings#player$/)

    await page.reload()
    await expect(playerSectionLink).toHaveClass(/active/)

    const playerScrollPosition = await page.evaluate(() => window.scrollY)
    await page.mouse.wheel(0, 1200)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(playerScrollPosition)
  })

  test('keeps the scroll position when switching tabs', async ({ page }) => {
    await goTo(page, 'settings')

    const playerSectionLink = page.locator('.settingsMenu [data-section="player"]')
    await playerSectionLink.click()
    await expect(page).toHaveURL(/#\/settings#player$/)

    // Scroll within the section, so the active section (and therefore the hash)
    // stays the same.
    const sectionScrollPosition = await page.evaluate(() => window.scrollY)
    await page.mouse.wheel(0, 200)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(sectionScrollPosition)
    const scrollPosition = await page.evaluate(() => window.scrollY)
    await expect(playerSectionLink).toHaveClass(/active/)

    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await page.locator(sel.tabs).first().click()
    await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
    await expect(page).toHaveURL(/#\/settings#player$/)
    await expect(playerSectionLink).toHaveClass(/active/)

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollPosition)
  })

  test('configures the watched percentage threshold', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="privacy"]').click()

    const threshold = page.getByRole('slider', { name: /Watched Percentage Threshold/ })
    await expect(threshold).toHaveValue('90')
    await threshold.fill('0')
    await expect(threshold).toHaveValue('0')
    await threshold.fill('100')
    await expect(threshold).toHaveValue('100')
  })

  test('enables YouTube-style Shorts by default in theme settings', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="theme"]').click()

    const toggle = page.getByRole('checkbox', { name: 'Use YouTube-style Shorts' })
    await expect(toggle).toBeChecked()

    await page.locator('label.switch-label')
      .filter({ hasText: 'Use YouTube-style Shorts' })
      .click()
    await expect(toggle).not.toBeChecked()
  })

  test('the tab width slider only becomes usable with fixed tab width on', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="theme"]').click()

    const slider = page.getByRole('slider', { name: /Tab Width/ })
    await expect(slider).toBeDisabled()

    await page.locator('label.switch-label')
      .filter({ hasText: 'Use Fixed Tab Width in Horizontal Mode' })
      .click()
    await expect(page.getByRole('checkbox', { name: 'Use Fixed Tab Width in Horizontal Mode' })).toBeChecked()
    await expect(slider).toBeEnabled()

    // Dragging resizes the tabs live.
    await slider.evaluate((input) => {
      input.value = '100'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect.poll(async () => {
      return await page.locator(sel.activeTab).evaluate(
        tab => Math.round(tab.getBoundingClientRect().width)
      )
    }).toBe(100)
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

  test('links the public sync server privacy policy', async ({ page }) => {
    await goTo(page, 'settings')

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.locator('label.switch-label').filter({ hasText: 'Enable Sync' }).click()

    const privacyPolicy = syncSection.getByRole('link', {
      name: 'Privacy policy for this server'
    })

    await expect(privacyPolicy).toHaveAttribute(
      'href',
      'https://github.com/OpenTubeX/sync-server/blob/main/PRIVACY.md'
    )

    await syncSection.getByLabel('Server URL').fill('https://sync.libretube.dev')
    await expect(privacyPolicy).toHaveCount(0)
  })

  test('keeps the sync server idle until sync is enabled', async ({ page }) => {
    const syncRequests = []
    await page.route('https://sync.d3sox.me/**', async (route) => {
      syncRequests.push(route.request().url())
      await route.fulfill({ status: 200, body: 'OK' })
    })
    await goTo(page, 'settings')

    const syncSection = page.locator('[data-section="sync"]')
    await expect(syncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect(syncSection.getByLabel('Server URL')).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(syncRequests).toEqual([])
  })

  test('loads each experimental icon pack when selected', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="experimental"]').click()

    const preview = page.locator('.iconPackPreview')
    const select = preview.locator('select')
    for (const pack of ['material', 'tabler', 'phosphor', 'lucide', 'remix']) {
      await select.selectOption(pack)
      await expect(preview.locator('.previewIcon.ft-icon').first()).toBeVisible()
      await expect(preview.locator('.ft-icon__glyph').first()).toBeVisible()
    }

    await page.reload()
    await page.locator('.settingsMenu [data-section="experimental"]').click()
    await expect(preview.locator('select')).toHaveValue('remix')
    await expect(preview.locator('.ft-icon__glyph').first()).toBeVisible()
  })

  test('keeps the current icon pack when another pack fails to load', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="experimental"]').click()

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

    const select = page.locator('.iconPackPreview select')
    const loadFailure = page.waitForEvent('console', message => (
      message.type() === 'error' && message.text().includes('[icon-pack] failed to load material')
    ))
    await select.selectOption('material')
    await loadFailure
    expect(errors).toEqual([])

    await page.reload()
    await page.locator('.settingsMenu [data-section="experimental"]').click()
    await expect(select).toHaveValue('fontawesome')
  })

  test('renders custom icons with the default Font Awesome pack', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="experimental"]').click()

    const preview = page.locator('.iconPackPreview')
    await expect(preview.locator('select')).toHaveValue('fontawesome')

    for (const icon of [
      'vertical-tabs',
      'horizontal-tabs',
      'playlist-add',
      'playlist-check'
    ]) {
      await expect(
        preview.locator(`[title="fac ${icon}"] svg[data-prefix="fac"][data-icon="${icon}"]`)
      ).toBeVisible()
    }
  })

  test('a toggled setting persists across restarts', async ({ app }) => {
    let page = app.page
    await goTo(page, 'settings')

    const toggle = page.getByRole('checkbox', { name: 'Check for Updates' })
    await expect(toggle).not.toBeChecked()
    // The styled label covers the checkbox input, so click that instead.
    await page.locator('label.switch-label').filter({ hasText: 'Check for Updates' }).click()
    await expect(toggle).toBeChecked()
    // Give nedb a moment to flush the write.
    await page.waitForTimeout(1000)

    ;({ page } = await app.relaunch())
    await goTo(page, 'settings')
    await expect(page.getByRole('checkbox', { name: 'Check for Updates' })).toBeChecked()
  })

  test('highlights changed settings and resets them to defaults', async ({ page }) => {
    await goTo(page, 'settings')

    const autoLoadToggle = page.getByRole('checkbox', { name: /Auto Load Next Page/i })
    await page.locator('label.switch-label').filter({ hasText: 'Auto Load Next Page' }).click()
    await expect(autoLoadToggle).toBeChecked()

    await page.locator('label.switch-label')
      .filter({ hasText: 'Highlight settings changed from defaults' })
      .click()

    const autoLoadSetting = page.locator('.switch-ctn').filter({ has: autoLoadToggle })
    const resetButton = autoLoadSetting.getByRole('button', { name: 'Reset this setting to its default' })
    await expect(resetButton).toBeVisible()
    await expect(autoLoadSetting).toHaveCSS('border-left-width', '3px')

    await resetButton.click()
    await expect(autoLoadToggle).not.toBeChecked()
    await expect(resetButton).toHaveCount(0)
  })

  test('highlights and resets caption appearance settings individually', async ({ page }) => {
    await goTo(page, 'settings')

    await page.locator('label.switch-label')
      .filter({ hasText: 'Highlight settings changed from defaults' })
      .click()
    await page.locator('.settingsMenu [data-section="caption-appearance"]').click()

    const backgroundOpacity = page.getByRole('slider', { name: /Background Opacity/ })
    await backgroundOpacity.fill('50')

    const changedControl = page.locator('.pure-material-slider')
      .filter({ has: backgroundOpacity })
    const resetButton = changedControl.getByRole('button', {
      name: 'Reset this setting to its default'
    })

    await expect(resetButton).toBeVisible()
    await expect(changedControl).toHaveCSS('border-left-width', '3px')
    await expect(page.locator('.captionControls').getByRole('button', {
      name: 'Reset this setting to its default'
    })).toHaveCount(1)

    await resetButton.click()
    await expect(backgroundOpacity).toHaveValue('80')
    await expect(resetButton).toHaveCount(0)
  })

  test('highlights and resets SponsorBlock category values individually', async ({ page }) => {
    await goTo(page, 'settings')

    await page.locator('label.switch-label')
      .filter({ hasText: 'Highlight settings changed from defaults' })
      .click()
    await page.locator('.settingsMenu [data-section="sponsor-block"]').click()
    await page.locator('label.switch-label')
      .filter({ hasText: 'Enable SponsorBlock' })
      .click()

    const sponsorCategory = page.locator('.sponsorBlockCategory')
      .filter({ has: page.locator('.sponsorTitle', { hasText: /^Sponsor$/ }) })
    const color = sponsorCategory.locator('select').nth(0)
    const skipOption = sponsorCategory.locator('select').nth(1)

    await color.selectOption('Red')

    const resetButton = sponsorCategory.getByRole('button', {
      name: 'Reset this setting to its default'
    })
    await expect(resetButton).toHaveCount(1)
    await expect(color).toHaveValue('Red')
    await expect(skipOption).toHaveValue('autoSkip')

    await resetButton.click()
    await expect(color).toHaveValue('Green')
    await expect(skipOption).toHaveValue('autoSkip')
    await expect(resetButton).toHaveCount(0)

    await skipOption.selectOption('promptToSkip')
    await expect(resetButton).toHaveCount(1)
    await resetButton.click()
    await expect(color).toHaveValue('Green')
    await expect(skipOption).toHaveValue('autoSkip')
    await expect(resetButton).toHaveCount(0)
  })

  test('positions toasts and dismisses them towards the configured edge', async ({ page }) => {
    await goTo(page, 'settings')

    const themeSection = page.locator('[data-section="theme"]')
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
      return toast
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

      const indicatorTrack = toast.locator('..').locator('.timeout-indicator-track')
      const transforms = await Promise.all([
        toast.evaluate(element => getComputedStyle(element).transform),
        indicatorTrack.evaluate(element => getComputedStyle(element).transform)
      ])
      expect(transforms[1]).toBe(transforms[0])
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
    await expect(holder).toHaveCSS('bottom', '24px')
    let toast = await showToast('Left toast')
    let bounds = await toast.boundingBox()
    expect(bounds.x).toBeLessThan(50)
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toBeVisible()
    await expect(toast).toHaveCSS('transform', 'none')
    await dragToast(toast, -dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('bottom-center')
    await expect(holder).toHaveClass(/position-bottom-center/)
    await expect(holder).toHaveCSS('transform', 'none')
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
    await expect(toast).toHaveCSS('transform', 'none')
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('top-left')
    await expect(holder).toHaveClass(/position-top-left/)
    await expect(holder).toHaveCSS('top', '56px')
    toast = await showToast('Top left toast')
    bounds = await toast.boundingBox()
    expect(bounds.x).toBeLessThan(50)
    await dragToast(toast, -dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('top-center')
    await expect(holder).toHaveClass(/position-top-center/)
    await expect(holder).toHaveCSS('top', '56px')
    toast = await showToast('Top center toast')
    bounds = await toast.boundingBox()
    viewport = await viewportSize()
    expect(bounds.x + bounds.width / 2).toBeCloseTo(viewport.width / 2, 0)
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)

    await positionSelect.selectOption('top-right')
    await expect(holder).toHaveClass(/position-top-right/)
    await expect(holder).toHaveCSS('top', '56px')
    toast = await showToast('Top right toast')
    bounds = await toast.boundingBox()
    viewport = await viewportSize()
    expect(bounds.x + bounds.width).toBeGreaterThan(viewport.width - 50)
    await dragToast(toast, dismissDragDistance)
    await page.mouse.up()
    await expect(toast).toHaveCount(0)
  })

  test('configures the toast timeout indicator and pauses toasts on hover', async ({ page }) => {
    await goTo(page, 'settings')

    const themeSection = page.locator('[data-section="theme"]')
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
    const toastSlot = toast.locator('..')
    const indicator = toast.locator('..').locator('.timeout-indicator .embeddedProgressPath')
    await expect(toastSlot).toHaveCSS('transform', 'none')
    await toastSlot.dispatchEvent('pointerenter')
    // Reported as a list so a failure says which animations were on the element
    // and what state they were in, instead of just "expected paused"
    await expect.poll(() => indicator.evaluate((element) => {
      return element.getAnimations().map(animation => [
        animation.animationName ?? animation.transitionProperty ?? animation.constructor.name,
        animation.playState,
      ].join(':'))
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/^toast-timeout[\w-]*:paused$/),
    ]))
    await page.waitForTimeout(2200)
    await expect(toast).toBeVisible()

    await toastSlot.dispatchEvent('pointerleave')
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
    await page.waitForTimeout(400)
    await firstAlternatingToast.hover()
    await secondAlternatingToast.hover()
    await page.waitForTimeout(300)
    await firstAlternatingToast.hover()

    const firstIndicatorProgress = await firstAlternatingToast
      .locator('..')
      .locator('.timeout-indicator .embeddedProgressPath')
      .evaluate((element) => ({
        elapsedRatio: element.getAnimations()[0].currentTime /
          element.getAnimations()[0].effect.getTiming().duration,
        transform: getComputedStyle(element).transform,
      }))
    expect(firstIndicatorProgress.elapsedRatio).toBeGreaterThan(0.15)
    expect(firstIndicatorProgress.transform).toBe('none')

    await page.mouse.move(800, 300)

    await page.locator('label.switch-label')
      .filter({ hasText: 'Show toast timeout indicator' })
      .click()
    await expect(indicatorToggle).not.toBeChecked()

    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('No indicator toast', 2000)
    })
    const toastWithoutIndicator = page.locator('.toast', { hasText: 'No indicator toast' })
    const toastWithoutIndicatorSlot = toastWithoutIndicator.locator('..')
    await expect(toastWithoutIndicatorSlot).toHaveCSS('transform', 'none')
    await toastWithoutIndicatorSlot.dispatchEvent('pointerenter')
    await expect(toastWithoutIndicatorSlot.locator('.timeout-indicator')).toHaveCount(0)
    await page.waitForTimeout(2200)
    await expect(toastWithoutIndicator).toBeVisible()

    await toastWithoutIndicatorSlot.dispatchEvent('pointerleave')
    await expect(toastWithoutIndicator).toHaveCount(0)
  })
})

test.describe('SponsorBlock highlight settings', () => {
  test.use({
    seed: {
      settings: {
        highlightChangedSettings: true,
        sponsorBlockHighlight: {
          color: 'Blue',
          skip: 'autoSkip'
        },
        useSponsorBlock: true
      }
    }
  })

  test('preserves the stored skip option when resetting only the color', async ({ app }) => {
    const { page } = app
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sponsor-block"]').click()

    const highlightCategory = page.locator('.sponsorBlockCategory')
      .filter({ has: page.locator('.sponsorTitle', { hasText: /^Highlight$/ }) })
    const color = highlightCategory.locator('select').nth(0)
    const skipOption = highlightCategory.locator('select').nth(1)

    await expect(color).toHaveValue('Blue')
    await expect(skipOption).toHaveValue('promptToSkip')
    await highlightCategory.getByRole('button', {
      name: 'Reset this setting to its default'
    }).click()
    await expect(color).toHaveValue('Red')

    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return settings.sponsorBlockHighlight
    }).toEqual({
      color: 'Red',
      skip: 'autoSkip'
    })
  })
})

test.describe('sync settings', () => {
  test.use({
    seed: {
      settings: {
        syncServerEnabled: true,
        syncServerAutoSync: false,
        syncServerPrivacyKey: 'e2e-privacy-key',
        syncServerPrivacyMode: 'legacy',
        syncServerSnapshot: '{"subscriptions":[]}',
        syncServerToken: 'invalid-token',
        syncServerUrl: 'https://sync.d3sox.me',
        syncServerUsername: 'sync-user',
        syncServerLastSyncAt: 1234
      }
    }
  })

  test('clears a sync error and enables credentials after disconnecting', async ({ page }) => {
    let finishServerCheck
    let serverCheckStarted
    const serverCheckPending = new Promise((resolve) => {
      finishServerCheck = resolve
    })
    const serverCheckRequested = new Promise((resolve) => {
      serverCheckStarted = resolve
    })
    await page.route('https://sync.d3sox.me/**', async (route) => {
      if (new URL(route.request().url()).pathname === '/health') {
        serverCheckStarted()
        await serverCheckPending
        await route.fulfill({ status: 200, body: 'OK' })
      } else {
        await route.fulfill({ status: 500, body: 'Sync failed' })
      }
    })
    await goTo(page, 'settings')

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    await expect(syncSection.locator('.error')).toHaveText('Sync failed')

    await expect(syncSection.getByLabel('Server URL')).toBeDisabled()
    await expect(syncSection.getByLabel('Username')).toBeDisabled()
    await syncSection.getByRole('button', { name: 'Disconnect' }).click()

    try {
      await serverCheckRequested
      await expect(syncSection.locator('.error')).toHaveCount(0)
      await expect(syncSection.getByLabel('Server URL')).toBeEnabled()
      await expect(syncSection.getByLabel('Username')).toBeEnabled()
      await expect(syncSection.getByLabel('Password')).toBeEnabled()
    } finally {
      finishServerCheck()
    }
  })

  test('stops an active sync when sync is disabled', async ({ page }) => {
    let finishSyncRequest
    let syncRequestStarted
    const syncRequestPending = new Promise((resolve) => {
      finishSyncRequest = resolve
    })
    const syncRequestRequested = new Promise((resolve) => {
      syncRequestStarted = resolve
    })
    const syncRequests = []

    await page.route('https://sync.d3sox.me/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/health') {
        await route.fulfill({ status: 200, body: 'OK' })
        return
      }

      syncRequests.push(pathname)
      syncRequestStarted()
      await syncRequestPending
      await route.fulfill({ status: 200, json: [] })
    })
    await goTo(page, 'settings')

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    await syncRequestRequested
    await syncSection.getByText('Enable Sync', { exact: true }).click()
    finishSyncRequest()

    await expect(syncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect(syncSection.locator('.syncProgress')).toBeHidden()
    await expect(syncSection.locator('.error')).toHaveCount(0)
    await expect(page.locator('.toast', { hasText: 'Sync completed' })).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(syncRequests).toHaveLength(1)
  })

  test('stops an active sync in another window when sync is disabled', async ({ app, page }) => {
    const [otherWindow] = await Promise.all([
      app.electronApp.waitForEvent('window'),
      page.locator('.topNav .navNewWindowButton').click()
    ])
    await waitForAppReady(otherWindow)

    let finishSyncRequest
    let syncRequestStarted
    const syncRequestPending = new Promise((resolve) => {
      finishSyncRequest = resolve
    })
    const syncRequestRequested = new Promise((resolve) => {
      syncRequestStarted = resolve
    })
    const syncRequests = []

    await otherWindow.route('https://sync.d3sox.me/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/health') {
        await route.fulfill({ status: 200, body: 'OK' })
        return
      }
      syncRequests.push(pathname)
      syncRequestStarted()
      await syncRequestPending
      await route.fulfill({ status: 200, json: [] }).catch(() => {})
    })

    await goTo(page, 'settings')
    await goTo(otherWindow, 'settings')
    const firstSyncSection = page.locator('[data-section="sync"]')
    const otherSyncSection = otherWindow.locator('[data-section="sync"]')

    await otherSyncSection.getByRole('button', { name: 'Sync now' }).click()
    await syncRequestRequested
    await firstSyncSection.getByText('Enable Sync', { exact: true }).click()
    finishSyncRequest()

    await expect(firstSyncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect(otherSyncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect(otherSyncSection.locator('.syncProgress')).toBeHidden()
    await otherWindow.waitForTimeout(500)
    expect(syncRequests).toHaveLength(1)
  })

  test('cancels authentication without storing a new token when sync is disabled', async ({ app, page }) => {
    let finishAuthentication
    let authenticationStarted
    const authenticationPending = new Promise((resolve) => {
      finishAuthentication = resolve
    })
    const authenticationRequested = new Promise((resolve) => {
      authenticationStarted = resolve
    })

    await page.route('https://sync.d3sox.me/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/health') {
        await route.fulfill({ status: 200, body: 'OK' })
        return
      }
      authenticationStarted()
      await authenticationPending
      await route.fulfill({ status: 200, json: { jwt: 'late-token' } }).catch(() => {})
    })

    await goTo(page, 'settings')
    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Disconnect' }).click()
    await syncSection.getByLabel('Username').fill('sync-user')
    await syncSection.getByLabel('Password').fill('sync-password')
    await syncSection.getByRole('button', { name: 'Log in' }).click()
    await authenticationRequested
    await syncSection.getByText('Enable Sync', { exact: true }).click()
    finishAuthentication()

    await expect(syncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return settings.syncServerToken
    }).toBe('')
  })

  test('disables credentials while authentication is pending', async ({ page }) => {
    let finishAuthentication
    const authenticationPending = new Promise((resolve) => {
      finishAuthentication = resolve
    })
    await page.route('https://sync.d3sox.me/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/health') {
        await route.fulfill({ status: 200, body: 'OK' })
      } else {
        await authenticationPending
        await route.fulfill({ status: 401, body: 'Invalid credentials' })
      }
    })
    await goTo(page, 'settings')

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Disconnect' }).click()
    await expect(syncSection.getByLabel('Username')).toBeEnabled()
    await syncSection.getByLabel('Username').fill('sync-user')
    await syncSection.getByLabel('Password').fill('sync-password')
    await syncSection.getByRole('button', { name: 'Log in' }).click()

    await expect(syncSection.getByLabel('Server URL')).toBeDisabled()
    await expect(syncSection.getByLabel('Username')).toBeDisabled()
    await expect(syncSection.getByLabel('Password')).toBeDisabled()
    await expect(syncSection.getByRole('button', { name: 'Log in' })).toBeDisabled()
    await expect(syncSection.getByRole('button', { name: 'Register' })).toBeDisabled()

    finishAuthentication()
    await expect(syncSection.locator('.error')).toHaveText('Invalid credentials')
    await expect(syncSection.getByLabel('Server URL')).toBeEnabled()
    await expect(syncSection.getByLabel('Username')).toBeEnabled()
    await expect(syncSection.getByLabel('Password')).toBeEnabled()
  })

  test('preserves the sync baseline while reauthenticating an expired session', async ({ app, page }) => {
    let finishPostLoginSync
    let postLoginSyncStarted
    const postLoginSyncPending = new Promise((resolve) => {
      finishPostLoginSync = resolve
    })
    const postLoginSyncRequested = new Promise((resolve) => {
      postLoginSyncStarted = resolve
    })
    let authenticatedManifestRequests = 0

    await page.route('https://sync.d3sox.me/**', async (route) => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      const authorization = request.headers().authorization

      if (pathname === '/health') {
        await route.fulfill({
          status: 200,
          json: { capabilities: { encrypted_sync: 1 } }
        })
      } else if (pathname === '/v1/account/login') {
        await route.fulfill({ status: 200, json: { jwt: 'renewed-token' } })
      } else if (authorization === 'invalid-token') {
        await route.fulfill({
          status: 401,
          body: 'Invalid or missing authentication token'
        })
      } else if (pathname === '/v1/encrypted_sync') {
        authenticatedManifestRequests++
        if (authenticatedManifestRequests === 2) {
          postLoginSyncStarted()
          await postLoginSyncPending
        }
        await route.fulfill({ status: 200, json: { collections: [] } })
      } else if (request.method() === 'PUT') {
        await route.fulfill({ status: 200, json: {} })
      } else {
        await route.fulfill({ status: 200, json: { revision: 0 } })
      }
    })
    await goTo(page, 'settings')

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    await expect(syncSection.locator('.error')).toHaveText(
      'Sync server session expired. Sign in again to resume syncing.'
    )
    await expect(syncSection.getByLabel('Username')).toBeEnabled()

    await syncSection.getByLabel('Password').fill('sync-password')
    await syncSection.getByLabel(/Privacy passphrase/).fill('sync-privacy-passphrase')
    await syncSection.getByRole('button', { name: 'Log in' }).click()

    try {
      await postLoginSyncRequested
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      expect(settings.syncServerSnapshot).toBe('{"subscriptions":[]}')
      expect(settings.syncServerLastSyncAt).toBe(1234)
    } finally {
      finishPostLoginSync()
    }

    await expect(syncSection.getByText('Connected as sync-user')).toBeVisible()
    await expect(syncSection.getByText(/Last synced:/)).toBeVisible()
  })
})

test.describe('invalid toast position', () => {
  test.use({ seed: { settings: { toastPosition: 'unsupported' } } })

  test('falls back to bottom left', async ({ page }) => {
    await goTo(page, 'settings')

    const positionSelect = page.locator('[data-section="theme"] .select')
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

test.describe('synced setting indicators', () => {
  test.use({
    seed: {
      settings: {
        reducedMotion: 'on',
        syncServerEnabled: true,
        syncServerAutoSync: false,
        syncServerSyncSettings: true,
        syncServerToken: 'e2e-sync-token'
      }
    }
  })

  test('allows account sync to be disabled per setting', async ({ page }) => {
    await goTo(page, 'settings')

    const syncedLabel = page.locator('label').filter({ hasText: 'Default Landing Page' })
    const syncButton = syncedLabel.getByRole('button', { name: 'Stop syncing this setting' })
    await expect(syncButton).toBeVisible()
    await syncButton.click()
    await expect(syncedLabel.getByRole('button', { name: 'Sync this setting' })).toBeVisible()

    await page.reload()
    await expect(syncedLabel.getByRole('button', { name: 'Sync this setting' })).toBeVisible()

    const toggle = page.getByRole('checkbox', { name: /Auto load next page/i })
    await page.locator('label').filter({ hasText: 'Auto load next page' })
      .getByRole('button', { name: 'Stop syncing this setting' })
      .click()
    await expect(toggle).not.toBeChecked()

    const localOnlyLabel = page.locator('label').filter({ hasText: 'Check for Updates' })
    await expect(localOnlyLabel.getByRole('button', { name: /syncing this setting/i })).toHaveCount(0)
  })

  test('spaces setting sync and help icons', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('label.switch-label')
      .filter({ hasText: 'Highlight settings changed from defaults' })
      .click()
    await page.locator('.settingsMenu [data-section="privacy"]').click()

    const slider = page.locator('label.pure-material-slider')
      .filter({ hasText: 'Watched Percentage Threshold' })
    const input = page.locator('label.selectLabel')
      .filter({ hasText: 'Automatic History Retention' })
    const select = page.locator('.select')
      .filter({ hasText: 'Save Watched Progress' })
    await select.locator('select').selectOption('never')

    for (const setting of [slider, input, select]) {
      const [syncBox, helpBox] = await Promise.all([
        setting.locator('.syncedSettingIndicator').boundingBox(),
        setting.locator('.selectTooltip').boundingBox()
      ])

      expect(syncBox).not.toBeNull()
      expect(helpBox).not.toBeNull()
      expect(syncBox.x - helpBox.x - helpBox.width).toBeGreaterThanOrEqual(6)
    }

    const [syncBox, resetBox] = await Promise.all([
      select.locator('.syncedSettingIndicator').boundingBox(),
      select.locator('.changedSettingIndicator').boundingBox()
    ])
    const helpBox = await select.locator('.selectTooltip').boundingBox()
    expect(syncBox).not.toBeNull()
    expect(resetBox).not.toBeNull()
    expect(helpBox).not.toBeNull()
    expect(Math.abs(helpBox.y + helpBox.height / 2 - syncBox.y - syncBox.height / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(syncBox.y - resetBox.y)).toBeLessThanOrEqual(1)
    expect(resetBox.x - syncBox.x - syncBox.width).toBeGreaterThanOrEqual(6)

    const tooltipText = select.locator('.selectTooltip .text')
    await select.locator('.selectTooltip button').focus()
    await expect(tooltipText).toBeVisible()

    const [tooltipTextBox, sectionBox] = await Promise.all([
      tooltipText.boundingBox(),
      select.locator('xpath=ancestor::*[@data-section="privacy"]').boundingBox()
    ])
    expect(tooltipTextBox).not.toBeNull()
    expect(sectionBox).not.toBeNull()
    expect(tooltipTextBox.width).toBeLessThan(sectionBox.width / 2)

    const removePlaylistsButton = page.getByRole('button', { name: 'Remove All Playlists' })
    const removePlaylistsButtonBox = await removePlaylistsButton.boundingBox()
    expect(removePlaylistsButtonBox).not.toBeNull()

    const overlapLeft = Math.max(tooltipTextBox.x, removePlaylistsButtonBox.x)
    const overlapRight = Math.min(
      tooltipTextBox.x + tooltipTextBox.width,
      removePlaylistsButtonBox.x + removePlaylistsButtonBox.width
    )
    const overlapTop = Math.max(tooltipTextBox.y, removePlaylistsButtonBox.y)
    const overlapBottom = Math.min(
      tooltipTextBox.y + tooltipTextBox.height,
      removePlaylistsButtonBox.y + removePlaylistsButtonBox.height
    )
    expect(overlapLeft).toBeLessThan(overlapRight)
    expect(overlapTop).toBeLessThan(overlapBottom)

    const overlapPoint = {
      x: (overlapLeft + overlapRight) / 2,
      y: (overlapTop + overlapBottom) / 2
    }
    await tooltipText.evaluate(element => {
      element.style.pointerEvents = 'auto'
    })
    await expect.poll(() => page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y)
      return element !== null && element.closest('[role="tooltip"]') !== null
    }, overlapPoint)).toBe(true)
  })

  test('renders select tooltips above neighboring setting indicators', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('label.switch-label')
      .filter({ hasText: 'Highlight settings changed from defaults' })
      .click()

    const startupSelect = page.locator('.select').filter({ hasText: 'On Startup' })
    await startupSelect.locator('select').selectOption('restoreTabLoadState')

    const tooltipText = startupSelect.locator('.selectTooltip .text')
    await startupSelect.locator('.selectTooltip button').focus()
    await expect(tooltipText).toBeVisible()

    const thumbnailIndicators = page.locator('.select')
      .filter({ hasText: 'Thumbnail Preference' })
      .locator('.selectIndicators')
    const [tooltipBox, indicatorsBox] = await Promise.all([
      tooltipText.boundingBox(),
      thumbnailIndicators.boundingBox()
    ])
    expect(tooltipBox).not.toBeNull()
    expect(indicatorsBox).not.toBeNull()

    const overlapLeft = Math.max(tooltipBox.x, indicatorsBox.x)
    const overlapRight = Math.min(
      tooltipBox.x + tooltipBox.width,
      indicatorsBox.x + indicatorsBox.width
    )
    const overlapTop = Math.max(tooltipBox.y, indicatorsBox.y)
    const overlapBottom = Math.min(
      tooltipBox.y + tooltipBox.height,
      indicatorsBox.y + indicatorsBox.height
    )
    expect(overlapLeft).toBeLessThan(overlapRight)
    expect(overlapTop).toBeLessThan(overlapBottom)

    await tooltipText.evaluate(element => {
      element.style.pointerEvents = 'auto'
    })
    await expect.poll(() => page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y)
      return element !== null && element.closest('[role="tooltip"]') !== null
    }, {
      x: (overlapLeft + overlapRight) / 2,
      y: (overlapTop + overlapBottom) / 2
    })).toBe(true)
  })
})
