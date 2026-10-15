import { test, expect, goTo, goToSettingsSection, latestSettings, setWindowSize, readDatastore } from '../../helpers/app.mjs'

test.describe('settings', () => {
  test('highlights changed settings and resets them to defaults', async ({ page, attachScreenshot }) => {
    await goTo(page, 'settings')

    const autoLoadToggle = page.getByRole('checkbox', { name: /Auto Load Next Page/i })
    await page.locator('label.switch-label').filter({ hasText: 'Auto Load Next Page' }).click()
    await expect(autoLoadToggle).not.toBeChecked()

    const autoLoadSetting = page.locator('.switch-ctn').filter({ has: autoLoadToggle })
    const resetButton = autoLoadSetting.getByRole('button', { name: 'Reset this setting to its default' })
    await expect(resetButton).toBeVisible()
    await expect(autoLoadSetting).toHaveCSS('border-left-width', '3px')
    await attachScreenshot('highlighted changed setting')

    await resetButton.click()
    await expect(autoLoadToggle).toBeChecked()
    await expect(resetButton).toHaveCount(0)
  })

  test('resets the composite thumbnail preference to its displayed default', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    const setting = appearance.locator('.select').filter({
      has: page.getByRole('combobox', { name: 'Thumbnail Preference' })
    })
    const select = setting.locator('select')

    await select.selectOption('blur')
    await expect(select).toHaveValue('blur')

    const resetButton = setting.getByRole('button', {
      name: 'Reset this setting to its default'
    })
    await expect(resetButton).toBeVisible()
    await resetButton.click()

    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return {
        blurThumbnails: store.getters.getBlurThumbnails,
        thumbnailPreference: store.getters.getThumbnailPreference
      }
    })).toEqual({ blurThumbnails: false, thumbnailPreference: '' })
    await expect(select).toHaveValue('')
    await expect(resetButton).toHaveCount(0)
  })

  test('turns thumbnail hover previews off from appearance settings', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    const toggle = appearance.getByRole('checkbox', { name: 'Show thumbnail previews' })

    const getCenterOffset = () => toggle.locator('..').evaluate(element => {
      const setting = element.getBoundingClientRect()
      const content = element.closest('.sectionBody').getBoundingClientRect()
      return Math.abs(
        setting.left + setting.width / 2 -
        (content.left + content.width / 2)
      )
    })
    expect(await getCenterOffset()).toBeLessThanOrEqual(1)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUiScale', 95)
    })
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(0.95, 2)
    expect(await getCenterOffset()).toBeLessThanOrEqual(1)

    await expect(toggle).toBeChecked()
    await appearance.locator('label.switch-label')
      .filter({ hasText: 'Show thumbnail previews' })
      .click()
    await expect(toggle).not.toBeChecked()
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getShowThumbnailPreviews
    })).toBe(false)
  })

  test('highlights changed backend fallback and deep-link settings', async ({ page }) => {
    await goTo(page, 'settings')

    for (const { section, name } of [{
      section: 'advanced',
      name: /non-preferred backend/i
    }, {
      section: 'general',
      name: /Open URLs Passed to OpenTubeX in a New Window/i
    }]) {
      await goToSettingsSection(page, section)
      const toggle = page.getByRole('checkbox', { name })
      const setting = page.locator('.switch-ctn').filter({ has: toggle })
      await setting.locator('label.switch-label').click()
      await expect(setting.getByRole('button', {
        name: 'Reset this setting to its default'
      })).toBeVisible()
      await expect(setting).toHaveCSS('border-left-width', '3px')
    }
  })

  test('highlights and resets caption appearance settings individually', async ({ page }) => {
    await goTo(page, 'settings')

    await page.locator('.settingsMenu [data-section="playback"]').click()

    await expect(page.locator('.captionSettings')).toHaveCSS('user-select', 'none')
    for (const captionControl of await page.locator('.captionControl').all()) {
      await expect(captionControl).toHaveCSS('border-width', '0px')
    }
    await expect(page.locator('.captionActions')).toHaveCSS('border-top-width', '0px')

    const resetCaptionAppearance = page.getByRole('button', {
      name: 'Reset Caption Appearance',
      exact: true
    })
    await expect(resetCaptionAppearance).toBeDisabled()
    const [captionActionsBounds, resetCaptionAppearanceBounds] = await Promise.all([
      page.locator('.captionActions').boundingBox(),
      resetCaptionAppearance.boundingBox()
    ])
    expect(resetCaptionAppearanceBounds.x + resetCaptionAppearanceBounds.width / 2)
      .toBeCloseTo(captionActionsBounds.x + captionActionsBounds.width / 2, 0)

    const backgroundOpacity = page.getByRole('slider', { name: /Background Opacity/ })
    await backgroundOpacity.fill('50')
    await expect(resetCaptionAppearance).toBeEnabled()

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
    await expect(resetCaptionAppearance).toBeDisabled()
  })

  test('highlights and resets SponsorBlock category values individually', async ({ page }) => {
    await goTo(page, 'settings')

    await page.locator('.settingsMenu [data-section="add-ons"]').click()
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
})

test.describe('synced setting indicators', () => {
  test.use({
    seed: {
      settings: {
        highlightChangedSettings: true,
        reducedMotion: 'on',
        syncServerEnabled: true,
        syncServerAutoSync: false,
        syncServerSyncSettings: true,
        syncServerToken: 'e2e-sync-token'
      }
    }
  })

  test('shares the subscription settings sync toggle between its button and subpage', async ({ page }) => {
    const section = await goToSettingsSection(page, 'subscription')
    const manager = section.locator('.manageButton').filter({ hasText: 'Subscription settings' })
    await manager.getByRole('button', { name: 'Stop syncing this setting' }).click()
    await expect(manager.getByRole('button', { name: 'Sync this setting' })).toHaveAttribute('aria-pressed', 'false')
    await manager.getByRole('button', { name: 'Subscription settings', exact: true }).click()
    const enable = page.locator('.settingsWindow .settingsBreadcrumb')
      .getByRole('button', { name: 'Sync this setting', exact: true })
    await expect(enable).toBeVisible()
    await enable.click()
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.state.settings.syncServerSettingsExcluded
    })).not.toContain('subscriptionChannelSettings')
    await page.reload()
    const reloaded = await goToSettingsSection(page, 'subscription')
    await expect(reloaded.locator('.manageButton').filter({ hasText: 'Subscription settings' })
      .getByRole('button', { name: 'Stop syncing this setting' })).toBeVisible()
  })

  test('allows account sync to be disabled per setting', async ({ page }) => {
    await goTo(page, 'settings')

    const landingPage = page.locator('.select').filter({ hasText: 'Default Landing Page' })
    const syncButton = landingPage.getByRole('button', { name: 'Stop syncing this setting' })
    await expect(syncButton).toBeVisible()
    await syncButton.click()
    await expect(landingPage.getByRole('button', { name: 'Sync this setting' })).toBeVisible()

    await page.reload()
    await goTo(page, 'settings')
    await expect(landingPage.getByRole('button', { name: 'Sync this setting' })).toBeVisible()

    const toggle = page.getByRole('checkbox', { name: /Auto load next page/i })
    await page.locator('label').filter({ hasText: 'Auto load next page' })
      .getByRole('button', { name: 'Stop syncing this setting' })
      .click()
    await expect(toggle).toBeChecked()

    const localOnlyLabel = page.locator('label').filter({ hasText: 'Check for Updates' })
    await expect(localOnlyLabel.getByRole('button', { name: /syncing this setting/i })).toHaveCount(0)
  })

  test('allows quick settings and navigation customization to be excluded independently', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    const quickSettings = appearance.locator('.settingButtonWithSync').filter({
      hasText: 'Customize quick settings'
    })
    const navigation = appearance.locator('.settingButtonWithSync').filter({
      hasText: 'Customize navigation'
    })

    await quickSettings.getByRole('button', { name: 'Stop syncing this setting' }).click()
    await expect(quickSettings.getByRole('button', { name: 'Sync this setting' })).toBeVisible()
    await expect(navigation.getByRole('button', { name: 'Stop syncing this setting' })).toBeVisible()

    await navigation.getByRole('button', { name: 'Stop syncing this setting' }).click()
    await expect(navigation.getByRole('button', { name: 'Sync this setting' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.state.settings.syncServerSettingsExcluded
    })).toEqual(['quickSettings', 'navigationItems'])

    await quickSettings.getByRole('button', { name: 'Sync this setting' }).click()
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.state.settings.syncServerSettingsExcluded
    })).toEqual(['navigationItems'])
  })

  for (const { section, label, settingKey } of [
    { section: 'appearance', label: 'Customize quick settings', settingKey: 'quickSettings' },
    { section: 'appearance', label: 'Customize navigation', settingKey: 'navigationItems' },
    { section: 'playback', label: 'Customize Quick Playback Speed Bar', settingKey: 'quickPlaybackSpeedBarOptions' }
  ]) {
    test(`shares the ${settingKey} sync toggle between its launcher and breadcrumb`, async ({ app, page }) => {
      const content = await goToSettingsSection(page, section)
      if (section === 'playback') {
        await content.locator('label.switch-label')
          .filter({ hasText: 'Use Quick Playback Speed Bar' }).click()
      }
      const launcher = content.locator('.settingButtonWithSync').filter({ hasText: label })
      await launcher.getByRole('button', { name: 'Stop syncing this setting' }).click()
      await launcher.getByRole('button', { name: label, exact: true }).click()

      const breadcrumb = page.locator('.settingsBreadcrumb')
      const sync = breadcrumb.locator('.syncedSettingIndicator')
      await expect(sync).toBeVisible()
      await expect(sync).toHaveAttribute('aria-pressed', 'false')
      await expect(sync).toHaveAccessibleName('Sync this setting')
      await sync.click()
      await expect(sync).toHaveAttribute('aria-pressed', 'true')
      await expect(sync).toHaveAccessibleName('Stop syncing this setting')
      await expect.poll(() => page.evaluate(() => (
        window.$store
          .state.settings.syncServerSettingsExcluded
      ))).toEqual([])

      await setWindowSize(app, page, { width: 480, height: 800 })
      await expect(sync).toBeVisible()
      await sync.click()
      await expect.poll(() => page.evaluate(() => (
        window.$store
          .state.settings.syncServerSettingsExcluded
      ))).toEqual([settingKey])

      await page.locator('.settingsBackButton').click()
      await expect(breadcrumb.locator('.syncedSettingIndicator')).toHaveCount(0)
      await expect(launcher.getByRole('button', { name: 'Sync this setting' }))
        .toHaveAttribute('aria-pressed', 'false')
    })
  }

  test('spaces setting sync and help icons', async ({ page }) => {
    await goTo(page, 'settings')

    const startup = page.locator('.generalSelectGrid .select')
      .filter({ hasText: 'On Startup' })
    await startup.locator('select').selectOption('restoreTabLoadState')
    const getStartupIconGap = async () => {
      const [selectBox, helpBox] = await Promise.all([
        startup.locator('.select-text').boundingBox(),
        startup.locator('.selectTooltip').boundingBox()
      ])
      expect(selectBox).not.toBeNull()
      expect(helpBox).not.toBeNull()
      return helpBox.x - selectBox.x - selectBox.width
    }
    expect(await getStartupIconGap()).toBeGreaterThanOrEqual(7.95)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUiScale', 95)
    })
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(0.95, 2)
    expect(await getStartupIconGap()).toBeGreaterThanOrEqual(7.95)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUiScale', 100)
    })
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(1, 2)

    await page.locator('.settingsMenu [data-section="privacy"]').click()

    const slider = page.locator('label.pure-material-slider')
      .filter({ hasText: 'Watched Percentage Threshold' })
    const select = page.locator('.select')
      .filter({ hasText: 'Save Watched Progress' })
    await select.locator('select').selectOption('never')

    for (const setting of [slider, select]) {
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

    const storage = await goToSettingsSection(page, 'storage')
    const input = storage.getByRole('spinbutton', { name: 'Automatic History Retention (Days)', exact: true }).locator('../..')
    const [inputSyncBox, inputHelpBox] = await Promise.all([
      input.locator('.syncedSettingIndicator').boundingBox(),
      input.locator('.selectTooltip').boundingBox()
    ])
    expect(inputSyncBox).not.toBeNull()
    expect(inputHelpBox).not.toBeNull()
    expect(inputSyncBox.x - inputHelpBox.x - inputHelpBox.width).toBeGreaterThanOrEqual(6)

    await input.locator('.selectTooltip button').focus()
    const tooltipText = page.locator('body > [role="tooltip"]:visible')
    await expect(tooltipText).toBeVisible()

    const [tooltipTextBox, sectionBox] = await Promise.all([
      tooltipText.boundingBox(),
      input.locator('xpath=ancestor::*[@data-section="data"]').boundingBox()
    ])
    expect(tooltipTextBox).not.toBeNull()
    expect(sectionBox).not.toBeNull()
    expect(tooltipTextBox.width).toBeLessThan(sectionBox.width / 2)

    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(tooltipTextBox.x).toBeGreaterThanOrEqual(0)
    expect(tooltipTextBox.y).toBeGreaterThanOrEqual(0)
    expect(tooltipTextBox.x + tooltipTextBox.width).toBeLessThanOrEqual(viewport.width)
    expect(tooltipTextBox.y + tooltipTextBox.height).toBeLessThanOrEqual(viewport.height)
    const tooltipCenter = {
      x: tooltipTextBox.x + tooltipTextBox.width / 2,
      y: tooltipTextBox.y + tooltipTextBox.height / 2
    }
    await tooltipText.evaluate(element => {
      element.style.pointerEvents = 'auto'
    })
    await expect.poll(() => page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y)
      return element !== null && element.closest('[role="tooltip"]') !== null
    }, tooltipCenter)).toBe(true)
  })

  test('spreads the theme sliders evenly over their rows', async ({ page }) => {
    await goTo(page, 'settings')
    const themeSection = await goToSettingsSection(page, 'appearance')
    const sliders = themeSection.locator('.sliderGrid > *')
    await expect(sliders).toHaveCount(7)

    const boxes = await sliders.evaluateAll((elements) => elements.map((element) => {
      const { y, width } = element.getBoundingClientRect()
      return { y: Math.round(y), width: Math.round(width) }
    }))

    // Fill each row with three controls before starting another row.
    const rowSizes = new Map()
    for (const { y } of boxes) {
      rowSizes.set(y, (rowSizes.get(y) ?? 0) + 1)
    }
    expect([...rowSizes.values()]).toEqual([3, 3, 1])
    // The row they landed on doesn't change how much room they get.
    expect(new Set(boxes.map(({ width }) => width)).size).toBe(1)
  })

  test('wraps the playback sliders in the same grid as the theme sliders', async ({ page }) => {
    await goTo(page, 'settings')
    const playbackSection = await goToSettingsSection(page, 'playback')
    const sliders = playbackSection.locator('.sliderGrid > *')
    await expect(sliders).toHaveCount(9)
    await expect(sliders.nth(5)).toContainText(/Max video playback rate/i)
    await expect(sliders.nth(6)).toContainText(/Parallel segment loading/i)
    await expect(sliders.nth(7)).toContainText(/Upcoming videos to preload/i)
    await expect(sliders.nth(8)).toContainText(/Concurrent Preloads/i)

    const boxes = await sliders.evaluateAll((elements) => elements.map((element) => {
      const { x, y, width } = element.getBoundingClientRect()
      return { x: Math.round(x), y: Math.round(y), width: Math.round(width) }
    }))

    const rowSizes = new Map()
    for (const { y } of boxes) {
      rowSizes.set(y, (rowSizes.get(y) ?? 0) + 1)
    }
    expect([...rowSizes.values()]).toEqual([3, 3, 3])
    expect(new Set(boxes.map(({ width }) => width)).size).toBe(1)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUiScale', 125)
    })
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(1.25, 2)

    const scaledLayout = await playbackSection.locator('.sliderGrid').evaluateAll(elements => {
      const overflows = []
      const rowSizes = []

      for (const element of elements) {
        const gridBounds = element.getBoundingClientRect()
        const sliderBounds = Array.from(element.children, child => child.getBoundingClientRect())
        const rows = new Map()

        for (const bounds of sliderBounds) {
          const y = Math.round(bounds.y)
          rows.set(y, (rows.get(y) ?? 0) + 1)
          overflows.push(
            gridBounds.left - bounds.left,
            bounds.right - gridBounds.right
          )
        }

        rowSizes.push(...rows.values())
      }

      return {
        maximumOverflow: Math.max(...overflows),
        maximumRowSize: Math.max(...rowSizes)
      }
    })
    expect(scaledLayout.maximumOverflow).toBeLessThanOrEqual(1)
    expect(scaledLayout.maximumRowSize).toBeLessThanOrEqual(3)
  })

  test('does not move a setting when its changed highlight appears', async ({ page }) => {
    await goTo(page, 'settings')

    const themeSection = await goToSettingsSection(page, 'appearance')
    const slider = themeSection.locator('label.pure-material-slider')
      .filter({ hasText: 'Scrollbar Width' })
    const label = slider.locator('.label')
    const neighbour = themeSection.locator('label.pure-material-slider')
      .filter({ hasText: 'Animation Speed' })

    // At its default the setting reserves the marker's space without showing it.
    await expect(slider).toHaveCSS('border-left-width', '3px')
    await expect(slider).toHaveCSS('border-left-color', 'rgba(0, 0, 0, 0)')

    const [labelBefore, neighbourBefore] = await Promise.all([
      label.boundingBox(),
      neighbour.boundingBox()
    ])

    await slider.getByRole('slider').fill('20')
    await expect(slider.getByRole('button', { name: 'Reset this setting to its default' }))
      .toBeVisible()

    // Reserving that space must not stop the marker from showing up.
    await expect(slider).not.toHaveCSS('border-left-color', 'rgba(0, 0, 0, 0)')

    // Gaining the marker and the reset icon must not resize or shift anything,
    // otherwise the row shifts under the pointer mid-drag.
    const [labelAfter, neighbourAfter] = await Promise.all([
      label.boundingBox(),
      neighbour.boundingBox()
    ])
    expect(labelAfter.x).toBeCloseTo(labelBefore.x, 0)
    expect(labelAfter.width).toBeCloseTo(labelBefore.width, 0)
    expect(labelAfter.height).toBe(labelBefore.height)
    expect(neighbourAfter.x).toBeCloseTo(neighbourBefore.x, 0)
  })

  test('reserves changed-setting markers for non-resettable controls', async ({ page }) => {
    await goTo(page, 'settings')

    const advanced = await goToSettingsSection(page, 'advanced')
    const providers = advanced.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Video and metadata providers', exact: true })
    })
    const proxyToggle = providers.locator('.switch-ctn')
      .filter({ hasText: 'Proxy Videos Through Invidious' })
    await expect(proxyToggle).toHaveCSS('border-left-width', '3px')

    const playback = await goToSettingsSection(page, 'playback')
    await expect(playback.getByText('Proxy Videos Through Invidious', { exact: true }))
      .toHaveCount(0)

    const themeSection = await goToSettingsSection(page, 'appearance')
    const smoothScrollingToggle = themeSection.locator('.switch-ctn')
      .filter({ hasText: 'Disable Smooth Scrolling' })
    await expect(smoothScrollingToggle).toHaveCSS('border-left-width', '3px')

    const playerSectionAgain = await goToSettingsSection(page, 'playback')
    const viewingModeSelect = playerSectionAgain.locator('.select')
      .filter({ hasText: 'Default Viewing Mode' })
    const [selectBox, selectLabelContentBox] = await Promise.all([
      viewingModeSelect.locator('.selectedValue').boundingBox(),
      viewingModeSelect.locator('.select-label > *').first().boundingBox()
    ])
    expect(selectBox).not.toBeNull()
    expect(selectLabelContentBox).not.toBeNull()
    expect(Math.abs(selectLabelContentBox.x - selectBox.x)).toBeLessThanOrEqual(1)
  })

  test('keeps a wrapped slider label beside its icons and above its track', async ({ page }) => {
    await goTo(page, 'settings')

    const themeSection = await goToSettingsSection(page, 'appearance')
    const slider = themeSection.locator('label.pure-material-slider')
      .filter({ hasText: 'Scrollbar Width' })
    const range = slider.getByRole('slider')
    const label = slider.locator('.label')

    // A shorter value must not make the label any narrower, otherwise dragging
    // the slider wraps and unwraps it, and the whole row jumps around.
    await range.fill('20')
    const wideValueBox = await label.boundingBox()
    await range.fill('4')
    const shortValueBox = await label.boundingBox()
    expect(wideValueBox).not.toBeNull()
    expect(shortValueBox).not.toBeNull()
    expect(shortValueBox.width).toBeCloseTo(wideValueBox.width, 0)

    await range.fill('20')
    // Narrow windows and longer translations make the label wrap on their own;
    // this is just a reliable way to reach the same width.
    await slider.evaluate((element) => { element.style.maxInlineSize = '150px' })

    const reset = slider.getByRole('button', { name: 'Reset this setting to its default' })
    await expect(reset).toBeVisible()

    const [labelBox, resetBox, rangeBox] = await Promise.all([
      label.boundingBox(),
      reset.boundingBox(),
      range.boundingBox()
    ])
    expect(labelBox).not.toBeNull()
    expect(resetBox).not.toBeNull()
    expect(rangeBox).not.toBeNull()

    // The label has to be the thing that wraps for the rest to mean anything.
    expect(labelBox.height).toBeGreaterThan(30)
    // Wrapped, it still keeps its size across the range.
    await range.fill('4')
    const wrappedShortValueBox = await label.boundingBox()
    expect(wrappedShortValueBox.height).toBe(labelBox.height)
    await range.fill('20')
    // The icon stays beside the label instead of dropping onto its own line.
    expect(resetBox.y).toBeGreaterThanOrEqual(labelBox.y)
    expect(resetBox.y + resetBox.height).toBeLessThanOrEqual(labelBox.y + labelBox.height + 1)
    expect(resetBox.x).toBeGreaterThanOrEqual(labelBox.x + labelBox.width)
    // A label that needs a second line pushes the track down instead of
    // running through it.
    expect(rangeBox.y).toBeGreaterThanOrEqual(labelBox.y + labelBox.height - 1)
  })

  test('renders select tooltips above neighboring setting indicators', async ({ page }) => {
    await goTo(page, 'settings')

    const startupSelect = page.locator('.select').filter({ hasText: 'On Startup' })
    await startupSelect.locator('select').selectOption('restoreTabLoadState')

    await startupSelect.locator('.selectTooltip button').focus()
    const tooltipText = page.locator('body > [role="tooltip"]:visible')
    await expect(tooltipText).toBeVisible()

    const neighboringIndicators = page.locator('.select')
      .filter({ hasText: 'Prefer untranslated video text' })
      .locator('.selectIndicators')
    const tooltipBox = await tooltipText.boundingBox()
    expect(tooltipBox).not.toBeNull()
    await neighboringIndicators.evaluate((element, { x, y }) => {
      element.style.position = 'fixed'
      element.style.inset = 'auto'
      element.style.left = `${x}px`
      element.style.top = `${y}px`
      element.style.transform = 'none'
    }, {
      x: tooltipBox.x + 10,
      y: tooltipBox.y + 10
    })
    const indicatorsBox = await neighboringIndicators.boundingBox()
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

test.describe('performance impact indicators', () => {
  // Pinned because the labels matched below are worded differently in the other
  // English locales, which is what the runner's system locale can resolve to
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('only shows the badges once they are switched on', async ({ app }) => {
    const { page } = app
    const section = await goToSettingsSection(page, 'add-ons')

    await expect(section.locator('.performanceImpact')).toHaveCount(0)

    await page.getByRole('button', { name: 'Show performance impact indicators' }).click()

    const sponsorBlock = section.locator('.switch-ctn')
      .filter({ hasText: 'Enable SponsorBlock' })
    const deArrowThumbnails = section.locator('.switch-ctn')
      .filter({ hasText: 'Use DeArrow for thumbnails' })
    await expect(sponsorBlock.locator('.performanceImpact')).toHaveText('Moderate impact')
    await expect(deArrowThumbnails.locator('.performanceImpact')).toHaveText('High impact')
    // Settings without a notable cost stay unlabelled, so that the badges keep meaning something
    await expect(section.locator('.switch-ctn')
      .filter({ hasText: 'Enable SponsorBlock Submission' })
      .locator('.performanceImpact')).toHaveCount(0)

    await expect.poll(async () => {
      const settings = latestSettings(
        readDatastore(app.userDataDir, 'settings')
      )
      return settings.showPerformanceImpactIndicators
    }).toBe(true)
  })
})

test.describe('performance impact indicators on selects', () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'en-US',
        showPerformanceImpactIndicators: true
      }
    }
  })

  test('keeps the badge inside the select it belongs to', async ({ page }) => {
    const section = await goToSettingsSection(page, 'playback')

    const defaultQuality = section.locator('.select')
      .filter({ has: page.getByText('Default Quality', { exact: true }) })
    const badge = defaultQuality.locator('.performanceImpact')
    await expect(badge).toBeVisible()

    // The label floats above the select and never wraps, so a badge that is too
    // wide reaches into whichever setting sits in the next column
    const [selectBox, badgeBox] = await Promise.all([
      defaultQuality.boundingBox(),
      badge.boundingBox()
    ])
    expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(selectBox.x + selectBox.width)
  })
})
