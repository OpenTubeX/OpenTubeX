import {
  test,
  expect,
  goTo,
  goToSettingsSection,
  latestSettings,
  sel,
  setWindowSize,
  readDatastore,
} from '../../helpers/app.mjs'

async function expectCompactCustomThemeEditor(page) {
  const appearance = await goToSettingsSection(page, 'appearance')
  await appearance.getByRole('button', { name: 'Create custom theme' }).click()

  const editor = page.locator('.customThemeEditor')
  await expect(editor.locator('.themeNameField input')).toBeVisible()

  const spacing = await editor.evaluate(element => {
    const contentBounds = element.closest('.settingsSubpageScroll').getBoundingClientRect()
    const nameFieldBounds = element.querySelector('.themeNameField').getBoundingClientRect()
    const buttonBounds = element.querySelector('.editorFooter .btn:last-child').getBoundingClientRect()
    return {
      top: nameFieldBounds.top - contentBounds.top,
      bottom: contentBounds.bottom - buttonBounds.bottom
    }
  })

  // Allow floating-point error from fractional UI scales.
  expect(spacing.top).toBeLessThanOrEqual(12.01)
  expect(spacing.bottom).toBeLessThanOrEqual(12.01)
}

test.describe('AI translation completions', () => {
  const englishLabel = 'Fill missing translations with AI-generated ones'
  const generatedLabel = 'ترجمة اختبار بالذكاء الاصطناعي'

  test.use({
    seed: { settings: { currentLocale: 'ar', useAITranslationCompletions: false } },
    localeOverrides: {
      ar: {},
      'ai/ar': {
        Settings: {
          'General Settings': {
            'Use AI Translation Completions': generatedLabel
          }
        }
      }
    }
  })

  test('fills missing text immediately and restores the human fallback when disabled', async ({ page }) => {
    const general = await goToSettingsSection(page, 'general')

    const toggle = general.getByRole('checkbox', { name: englishLabel })
    await expect(toggle).not.toBeChecked()
    await general.locator('label.switch-label').filter({ hasText: englishLabel }).click()

    const translatedToggle = general.getByRole('checkbox', { name: generatedLabel })
    await expect(translatedToggle).toBeChecked()
    await general.locator('label.switch-label').filter({ hasText: generatedLabel }).click()

    const humanFallbackToggle = general.getByRole('checkbox', { name: englishLabel })
    await expect(humanFallbackToggle).not.toBeChecked()

    const localeSelect = general.getByRole('combobox', {
      name: /Language preference|Locale Preference/
    })
    await localeSelect.click()
    await page.getByRole('option', { name: 'English (US) (100%)', exact: true }).click()
    await expect(humanFallbackToggle).toBeDisabled()
  })
})

test.describe('Invidious instance list refresh', () => {
  /** Resolves with a function that answers the held instance list request. */
  let listRequested

  test.use({
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

test.describe('date and time format preferences', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('defaults to the app language and offers explicit date and clock formats', async ({ page }) => {
    const general = await goToSettingsSection(page, 'general')
    const dateFormat = general.getByRole('combobox', { name: 'Date Format' })

    await expect(dateFormat).toContainText(/^Language default \(/)
    await dateFormat.click()
    await expect(page.getByRole('option', { name: 'DD.MM.YYYY', exact: true })).toBeVisible()
    await page.getByRole('option', { name: 'DD.MM.YYYY', exact: true }).click()
    await expect(dateFormat).toHaveText('DD.MM.YYYY')

    const timeFormat = general.getByRole('combobox', { name: 'Time Format' })
    await expect(timeFormat).toContainText(/^Language default \(/)
    await timeFormat.click()
    await page.getByRole('option', { name: /^24h \(/ }).click()
    await expect(timeFormat).toContainText(/^24h \(/)
  })
})

test.describe('settings', () => {
  test('uses distinct category names and descriptions', async ({ page }) => {
    await goTo(page, 'settings')

    await expect(page.getByRole('button', { name: 'Sort Settings Sections (A-Z)' }))
      .toHaveCount(0)
    expect(await page.locator('.settingsMenu [data-section]').evaluateAll(elements => (
      elements.map(element => element.dataset.section)
    ))).toEqual([
      'general',
      'appearance',
      'playback',
      'add-ons',
      'subscriptions',
      'download',
      'focus',
      'privacy',
      'data',
      'sync',
      'advanced'
    ])

    const subscriptions = page.locator('.settingsMenu [data-section="subscriptions"]')
    await expect(subscriptions.locator('.titleText')).toHaveText('Subscriptions')
    await expect(subscriptions.locator('.titleDescription'))
      .toHaveText('Feed refresh and display options')

    const playback = page.locator('.settingsMenu [data-section="playback"]')
    await expect(playback.locator('.titleDescription'))
      .toHaveText('Player, captions, and channel preferences')

    const downloads = page.locator('.settingsMenu [data-section="download"]')
    await expect(downloads.locator('.titleText')).toHaveText('Downloads')
    await expect(downloads.locator('.titleDescription'))
      .toHaveText('Folders, templates, and automatic rules')

    const privacy = page.locator('.settingsMenu [data-section="privacy"]')
    await expect(privacy.locator('.titleDescription'))
      .toHaveText('Viewing privacy and access controls')

    const data = page.locator('.settingsMenu [data-section="data"]')
    await expect(data.locator('.titleText')).toHaveText('Data & Storage')
    await expect(data.locator('.titleDescription'))
      .toHaveText('Import, export, disk usage, and cleanup')
    await expect(data.locator('.titleIcon')).toHaveAttribute('data-icon', 'box-archive')
  })

  test('keeps the IP block recovery script last in expanded Proxy settings', async ({ page }) => {
    const advanced = await goToSettingsSection(page, 'advanced')
    const proxy = advanced.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Proxy', exact: true })
    })

    await proxy.locator('label.switch-label').filter({ hasText: 'Enable Tor / Proxy' }).click()
    const testProxy = proxy.getByRole('button', { name: 'Test Proxy', exact: true })
    // The recovery script input already exists, so measuring it before the
    // proxy fields render would return its collapsed position.
    await expect(testProxy).toBeVisible()
    const [testProxyBox, recoveryScriptBox] = await Promise.all([
      testProxy.boundingBox(),
      proxy.getByLabel('IP block recovery script').boundingBox()
    ])

    expect(testProxyBox).not.toBeNull()
    expect(recoveryScriptBox).not.toBeNull()
    expect(recoveryScriptBox.y).toBeGreaterThan(testProxyBox.y)
    expect(recoveryScriptBox.y - (testProxyBox.y + testProxyBox.height))
      .toBeGreaterThanOrEqual(16)
  })

  test('keeps Replace HTTP Cache in Experimental settings', async ({ page }) => {
    await goToSettingsSection(page, 'data')
    const search = page.getByRole('searchbox', { name: 'Search settings' })
    await search.fill('Replace HTTP Cache')
    await page.getByRole('button', { name: 'Replace HTTP cache', exact: true }).click()
    const advanced = page.locator('.settingsContent > [data-section="advanced"]')

    await expect(advanced).toBeVisible()
    await expect(advanced.getByRole('heading', { name: 'Experimental', exact: true })).toBeVisible()
    await expect(advanced.getByRole('checkbox', { name: 'Replace HTTP Cache' })).toBeVisible()
  })

  test('puts theme controls before a separate Layout section', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    const headings = appearance.getByRole('heading', { level: 3 })

    await expect(headings).toHaveText([
      'Theme',
      'Layout',
      'Navigation & controls',
      'Video lists and thumbnails',
    ])
    const theme = appearance.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Theme', exact: true })
    })
    const layout = appearance.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Layout', exact: true })
    })
    await expect(theme.getByRole('combobox', { name: 'Base Theme' })).toBeVisible()
    await expect(theme.getByRole('button', { name: 'Create custom theme' })).toBeVisible()
    await expect(layout.getByRole('slider', { name: /UI Scale/ })).toBeVisible()
    await expect(layout.getByRole('combobox', { name: 'Base Theme' })).toHaveCount(0)
  })

  test('keeps the custom theme editor compact', { tag: '@scale' }, async ({ page }) => {
    await expectCompactCustomThemeEditor(page)
  })

  test('hides the redundant Privacy heading and keeps the Distraction Free group headings', async ({ page }) => {
    const privacy = await goToSettingsSection(page, 'privacy')
    const mainPrivacySection = privacy.locator('.settingsSection').first()
    const privacyHeading = mainPrivacySection.locator('.sectionTitle')
    await expect(privacyHeading).toHaveText('Privacy')
    await expect(privacyHeading).not.toBeVisible()

    await expect(privacy.getByRole('checkbox', { name: 'Metadata history' })).toHaveCount(0)

    const focus = await goToSettingsSection(page, 'focus')
    await expect(focus.locator('h4.groupTitle')).toHaveText([
      'General',
      'Visible While Paused in Full Window / Full Screen',
      'Subscriptions page',
      'Channel Page',
      'Watch Page'
    ])
  })

  test('keeps slider values and units together without padding at fractional UI scales', async ({ page }) => {
    for (const scale of [1, 1.25]) {
      await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
      for (const [section, name] of [
        ['focus', /Playing Interface Hide Delay/],
        ['focus', /Paused Interface Hide Delay/],
        ['appearance', /Scrollbar Width/],
      ]) {
        const settings = await goToSettingsSection(page, section)
        const value = settings.getByRole('slider', { name }).locator('../..').locator('.value')
        await expect.poll(() => value.evaluate(element => {
          const number = element.querySelector('.valueNumber')
          const numberRange = document.createRange()
          numberRange.selectNodeContents(number)
          const unitRange = document.createRange()
          unitRange.selectNodeContents(element.querySelector('.valueText').lastChild)
          return unitRange.getBoundingClientRect().left - numberRange.getBoundingClientRect().right
        })).toBeLessThanOrEqual(1)
        await expect.poll(() => value.evaluate(element => {
          const numberRange = document.createRange()
          numberRange.selectNodeContents(element.querySelector('.valueNumber'))
          return numberRange.getBoundingClientRect().left - element.getBoundingClientRect().left
        })).toBeLessThanOrEqual(1)
      }
    }
  })

  test('does not reserve unit text for a unitless slider', async ({ page }) => {
    const subscriptions = await goToSettingsSection(page, 'subscriptions')
    const slider = subscriptions.getByRole('slider', { name: /^To:/ })
    const value = slider.locator('..').locator('..').locator('.value')
    await expect.poll(() => value.evaluate(element => (
      getComputedStyle(element, '::after').content
    ))).toMatch(/^"\d+"$/)
  })

  test('keeps General help icons close to their selects', async ({ page }) => {
    await goTo(page, 'settings')
    const startup = page.locator('.generalSelectGrid .select').filter({ hasText: 'On Startup' })
    const gaps = await startup.evaluate(element => {
      const select = element.querySelector('.select-text').getBoundingClientRect()
      const tooltip = element.querySelector('.selectTooltip').getBoundingClientRect()
      const indicators = element.querySelector('.selectIndicators').getBoundingClientRect()
      const root = element.getBoundingClientRect()
      return {
        before: tooltip.left - select.right,
        after: root.right - indicators.right,
      }
    })

    expect(gaps.before).toBeLessThanOrEqual(16)
    expect(gaps.after).toBeLessThanOrEqual(16)
  })

  test('vertically centers switch tracks with long labels and setting indicators', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 480, height: 800 })
    const addOns = await goToSettingsSection(page, 'add-ons')
    await page.evaluate(() => {
      const store = window.$store
      return store.dispatch('updateHighlightChangedSettings', true)
    })

    const sponsorBlock = addOns.getByRole('checkbox', { name: 'Enable SponsorBlock', exact: true })
    if (!await sponsorBlock.isChecked()) {
      await addOns.locator('label.switch-label').filter({ hasText: 'Enable SponsorBlock' }).click()
    }

    const submission = addOns.locator('.switch-ctn').filter({
      has: page.getByText('Enable SponsorBlock Submission', { exact: true })
    })
    await expect(submission).toBeVisible()

    const centerOffset = await submission.evaluate(element => {
      const text = element.querySelector('.switch-label-text').getBoundingClientRect()
      const knob = element.querySelector('.switch-thumb').getBoundingClientRect()
      const knobCenter = knob.top + knob.height / 2
      return Math.abs(knobCenter - (text.top + text.height / 2))
    })

    expect(centerOffset).toBeLessThanOrEqual(1)
  })

  test('keeps General selects compact with readable values and contained indicators', async ({ page, attachScreenshot }) => {
    await goTo(page, 'settings')

    const grid = page.locator('.generalSelectGrid')
    const measurements = await grid.evaluate(element => {
      const gridBounds = element.getBoundingClientRect()
      const contentBounds = element.closest('.sectionBody').getBoundingClientRect()
      const widths = Array.from(element.querySelectorAll(':scope > .select'))
        .map(select => select.getBoundingClientRect().width)
      return {
        gridWidth: gridBounds.width,
        centerOffset: Math.abs(
          gridBounds.left + gridBounds.width / 2 -
          (contentBounds.left + contentBounds.width / 2)
        ),
        minimumSelectWidth: Math.min(...widths),
        maximumSelectWidth: Math.max(...widths),
        clippedText: Array.from(element.querySelectorAll('.select-placeholder, .selectedValue'))
          .filter(text => text.scrollWidth > text.clientWidth + 1).map(text => text.textContent),
        indicatorsOutside: Array.from(element.querySelectorAll('.iconSelect'))
          .filter(indicator => {
            const bounds = indicator.getBoundingClientRect()
            const field = indicator.closest('.select').querySelector('.select-text').getBoundingClientRect()
            return bounds.left < field.left - 1 || bounds.right > field.right + 1
          }).length
      }
    })

    expect(measurements.gridWidth).toBeLessThanOrEqual(1000)
    expect(measurements.centerOffset).toBeLessThanOrEqual(1)
    expect(measurements.minimumSelectWidth).toBeGreaterThanOrEqual(200)
    expect(measurements.maximumSelectWidth).toBeLessThanOrEqual(400)
    expect(measurements.clippedText).toEqual([])
    expect(measurements.indicatorsOutside).toBe(0)
    await attachScreenshot('compact General setting selects')
  })

  test('places an incomplete General toggle row at the inline start', async ({ page }) => {
    const general = await goToSettingsSection(page, 'general')
    const grid = general.locator('.switchColumnGrid').first()
    const visibleSwitches = grid.locator(':scope > *:visible')
    if ((await visibleSwitches.count()) % 2 === 0) {
      await visibleSwitches.first().evaluate(element => { element.style.display = 'none' })
    }
    const aiTranslations = general.getByRole('checkbox', {
      name: 'Fill missing translations with AI-generated ones'
    }).locator('..')

    for (const direction of ['ltr', 'rtl']) {
      await page.evaluate(value => { document.documentElement.dir = value }, direction)
      const inlineOffset = await grid.evaluate((element, aiTranslationElement) => {
        const gridBounds = element.getBoundingClientRect()
        const settingBounds = aiTranslationElement.getBoundingClientRect()
        const physicalOffset = settingBounds.left + settingBounds.width / 2 -
          (gridBounds.left + gridBounds.width / 2)
        return getComputedStyle(element).direction === 'rtl' ? -physicalOffset : physicalOffset
      }, await aiTranslations.elementHandle())

      expect(inlineOffset, direction).toBeLessThan(0)
    }
  })

  test('gives stacked General selects room for their captions', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 900,
        height: 700
      }))
    })
    await goTo(page, 'settings')

    const measurements = await page.locator('.generalSelectGrid').evaluate(element => {
      const gridBounds = element.getBoundingClientRect()
      const contentBounds = element.closest('.sectionBody').getBoundingClientRect()
      const selectWidths = Array.from(element.querySelectorAll(':scope > .select'))
        .map(select => select.getBoundingClientRect().width)
      return {
        columnCount: new Set(Array.from(element.querySelectorAll('.select-text'))
          .map(field => Math.round(field.getBoundingClientRect().left))).size,
        gridWidth: gridBounds.width,
        maximumSelectWidth: Math.max(...selectWidths),
        centerOffset: Math.abs(
          gridBounds.left + gridBounds.width / 2 -
          (contentBounds.left + contentBounds.width / 2)
        )
      }
    })

    expect(measurements.columnCount).toBe(1)
    expect(measurements.gridWidth).toBeLessThanOrEqual(500)
    expect(measurements.maximumSelectWidth).toBeLessThanOrEqual(500)
    expect(measurements.centerOffset).toBeLessThanOrEqual(1)
  })

  test('centers stacked switch columns in narrow settings sections', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 820,
        height: 700
      }))
    })
    await goTo(page, 'settings')

    for (const sectionType of ['general', 'subscriptions', 'focus', 'privacy']) {
      await page.locator(`.settingsMenu [data-section="${sectionType}"]`).click()
      const grids = page.locator(
        `.settingsContent > [data-section="${sectionType}"] .switchColumnGrid`
      )
      await expect(grids.first()).toBeVisible()

      const centerOffsets = await grids.evaluateAll(elements => elements.flatMap(grid => {
        const gridBounds = grid.getBoundingClientRect()
        const gridCenter = gridBounds.left + gridBounds.width / 2
        const columnControls = Array.from(grid.querySelectorAll(':scope > .switchColumn'))
          .flatMap(column => Array.from(column.children))
        const flowControls = Array.from(grid.querySelectorAll(':scope > .switch-ctn'))
        return [...columnControls, ...flowControls]
          .map(child => child.getBoundingClientRect())
          .filter(bounds => bounds.width > 0 && bounds.height > 0)
          .map(bounds => Math.abs(bounds.left + bounds.width / 2 - gridCenter))
      }))

      expect(Math.max(...centerOffsets), sectionType).toBeLessThanOrEqual(1)

      const tooltipGaps = await grids.locator('.switch-ctn.containsTooltip').evaluateAll(elements => (
        elements.map(element => {
          const label = element.querySelector('.switch-label-text').getBoundingClientRect()
          const tooltip = element.querySelector('.tooltip .button').getBoundingClientRect()
          return tooltip.left - label.right
        })
      ))
      expect(Math.max(...tooltipGaps), sectionType).toBeLessThanOrEqual(8)
    }

    await page.locator('.settingsMenu [data-section="playback"]').click()
    const channelSettings = page.locator('.settingsContent .settingsSection').filter({
      has: page.getByRole('heading', { name: 'Channel Settings', exact: true })
    })
    const preferenceOffsets = await channelSettings.locator('.preferenceToggles').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const center = bounds.left + bounds.width / 2
      return Array.from(element.querySelectorAll('.preferenceToggle > .switch-ctn'))
        .map(toggle => {
          const toggleBounds = toggle.getBoundingClientRect()
          return Math.abs(toggleBounds.left + toggleBounds.width / 2 - center)
        })
    })
    expect(Math.max(...preferenceOffsets)).toBeLessThanOrEqual(1)
  })

  test('groups confirmation preferences together', async ({ page }) => {
    await goTo(page, 'settings')

    const labels = [
      'Closing OpenTubeX',
      'Closing a window with multiple tabs',
      'Closing multiple tabs',
      'Loading multiple tabs',
      'Unloading multiple tabs'
    ]
    await expect(page.getByRole('heading', { name: 'Confirm before…', exact: true })).toBeVisible()
    for (const label of labels) {
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    }

    const [first, second, third] = await Promise.all(labels.slice(0, 3).map(label => (
      page.getByText(label, { exact: true }).boundingBox()
    )))
    expect(second.y).toBeCloseTo(first.y, 0)
    expect(first.x).toBeLessThan(second.x)
    expect(third.y).toBeGreaterThan(first.y)
  })

  test('places online activity controls in General and Privacy without a separate section', async ({ page }) => {
    const general = await goToSettingsSection(page, 'general')
    await expect(general.getByRole('checkbox', { name: /^Auto load next page\b/i })).toBeVisible()

    const privacyCategory = await goToSettingsSection(page, 'privacy')
    const privacy = privacyCategory.locator('.settingsSection').first()

    await expect(privacyCategory.getByRole('heading', {
      name: 'Online activity',
      exact: true
    })).toHaveCount(0)
    await expect(privacyCategory.getByRole('checkbox', { name: /^Auto load next page\b/i })).toHaveCount(0)
    const privacyColumns = privacy.locator('.switchColumn')
    await expect(privacyColumns).toHaveCount(2)
    await expect(privacyColumns.nth(1)).toContainText('Enable search suggestions')
    await expect(privacyColumns.nth(1)).toContainText('Remember Tab Navigation History')

    const select = privacy.locator('.privacyExternalLinkSelect')
    const centerOffset = await select.evaluate(element => {
      const selectBounds = element.getBoundingClientRect()
      const bodyBounds = element.closest('.sectionBody').getBoundingClientRect()
      return Math.abs(
        selectBounds.left + selectBounds.width / 2 -
        (bodyBounds.left + bodyBounds.width / 2)
      )
    })
    expect(centerOffset).toBeLessThanOrEqual(1)
  })

  test('does not focus a help tooltip when opening Downloads', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="download"]').click()

    await expect(page.locator('[role="tooltip"]:visible')).toHaveCount(0)
  })

  test('allows help tooltips outside the settings window', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 900,
        height: 360
      }))
    })
    await goTo(page, 'settings')

    const content = page.locator('.settingsContent')
    const tooltipButton = content.locator('.selectTooltip .button').last()
    await tooltipButton.evaluate(element => {
      const scrollContainer = element.closest('.settingsContent')
      const buttonBounds = element.getBoundingClientRect()
      const contentBounds = scrollContainer.getBoundingClientRect()
      scrollContainer.scrollTop += buttonBounds.bottom - contentBounds.bottom + 8
    })
    await tooltipButton.evaluate(element => element.focus({ preventScroll: true }))
    const tooltip = page.locator('body > [role="tooltip"]:visible')
    await expect(tooltip).toBeVisible()

    const [contentBounds, tooltipBounds, viewport, fontFamily] = await Promise.all([
      content.boundingBox(),
      tooltip.boundingBox(),
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      tooltip.evaluate(element => getComputedStyle(element).fontFamily)
    ])
    expect(tooltipBounds.y + tooltipBounds.height).toBeGreaterThan(contentBounds.y + contentBounds.height)
    expect(tooltipBounds.x).toBeGreaterThanOrEqual(7)
    expect(tooltipBounds.y).toBeGreaterThanOrEqual(7)
    expect(tooltipBounds.x + tooltipBounds.width).toBeLessThanOrEqual(viewport.width - 7)
    expect(tooltipBounds.y + tooltipBounds.height).toBeLessThanOrEqual(viewport.height - 7)
    expect(fontFamily).toContain('Geist')
  })

  test('keeps an open help tooltip aligned and visible in fullscreen', async ({ page }) => {
    await goTo(page, 'settings')

    const settingsWindow = page.locator('.settingsWindow')
    const tooltipButton = page.locator('.settingsContent .selectTooltip .button').first()
    await tooltipButton.focus()

    const bodyTooltip = page.locator('body > [role="tooltip"]:visible')
    await expect(bodyTooltip).toBeVisible()

    // Read the button and the tooltip in one frame. Sampling them in separate
    // round-trips lets a late layout change (the open transition, a font swap
    // resizing the tooltip) land between the two reads, which offsets the
    // baselines against each other and makes the comparison below unsatisfiable.
    const measure = () => page.evaluate(() => {
      const button = document.querySelector('.settingsContent .selectTooltip .button')
      const tooltip = Array.from(document.querySelectorAll('body > [role="tooltip"]'))
        .find(element => element.checkVisibility())
      const buttonBounds = button.getBoundingClientRect()
      const tooltipBounds = tooltip.getBoundingClientRect()
      return {
        buttonLeft: buttonBounds.left,
        anchorOffset: tooltipBounds.left - buttonBounds.left,
        tooltipLeft: tooltipBounds.left,
        tooltipRight: tooltipBounds.right,
        viewportWidth: innerWidth
      }
    })

    const EDGE_MARGIN = 8
    // The window animates open, so wait for the button to hold still before
    // taking the baseline.
    let previous = null
    await expect.poll(async () => {
      const current = await measure()
      const settled = previous !== null && current.buttonLeft === previous.buttonLeft
      previous = current
      return settled
    }).toBe(true)
    const initial = previous
    // The tooltip is clamped to the viewport, so it only tracks its button
    // while it has room. Move the window towards the side that still fits.
    const shift = initial.tooltipRight + 40 <= initial.viewportWidth - EDGE_MARGIN
      ? 40
      : -40
    expect(shift === 40 || initial.tooltipLeft - 40 >= EDGE_MARGIN).toBe(true)
    await settingsWindow.evaluate((element, offset) => {
      const bounds = element.getBoundingClientRect()
      element.style.translate = `${bounds.left + offset}px ${bounds.top}px`
    }, shift)

    // The tooltip stays anchored to its button: it keeps the same offset from
    // the button instead of merely moving by a similar amount.
    await expect.poll(async () => {
      const moved = await measure()
      return {
        buttonMoved: Math.abs(moved.buttonLeft - initial.buttonLeft - shift) <= 1,
        anchored: Math.abs(moved.anchorOffset - initial.anchorOffset) <= 1,
        withinViewport: moved.tooltipLeft >= EDGE_MARGIN &&
          moved.tooltipRight <= moved.viewportWidth - EDGE_MARGIN
      }
    }).toEqual({ buttonMoved: true, anchored: true, withinViewport: true })

    await settingsWindow.evaluate(element => element.requestFullscreen())
    await expect.poll(() => settingsWindow.evaluate(element => document.fullscreenElement === element)).toBe(true)
    await expect(settingsWindow.locator(':scope > [role="tooltip"]:visible')).toBeVisible()

    await page.evaluate(() => document.exitFullscreen())
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
    await expect(bodyTooltip).toBeVisible()
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

  test('the tab width slider only becomes usable with fixed tab width on', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const slider = page.getByRole('slider', { name: /Tab Width/ })
    const fixedWidthToggle = page.getByRole('dialog', { name: 'Settings' })
      .locator('label.switch-label')
      .filter({ hasText: 'Use Fixed Tab Width in Horizontal Mode' })
    await expect(fixedWidthToggle).toHaveCount(1)
    await expect(slider).toBeDisabled()

    await fixedWidthToggle.click()
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

  test('configures animation speed and disables it with reduced motion', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const slider = page.getByRole('slider', { name: /Animation Speed/ })
    await expect(slider).toHaveValue('100')
    await expect(slider).toBeEnabled()

    await slider.fill('200')
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getAnimationSpeed
    })).toBe(200)

    await page.evaluate(() => {
      window.ftElectron.showToastOnAllTabs('Wall-clock animation', 2000)
    })
    const timeoutIndicator = page.locator('.toast', { hasText: 'Wall-clock animation' })
      .locator('..').locator('.timeout-indicator .embeddedProgressPath')
    await expect.poll(() => timeoutIndicator.evaluate((element) => {
      return element.getAnimations()[0]?.playbackRate
    })).toBe(1)

    await page.evaluate(() => {
      const store = window.$store
      return store.dispatch('updateReducedMotion', 'on')
    })
    await expect(slider).toBeDisabled()

    await page.evaluate(() => {
      const store = window.$store
      return store.dispatch('updateReducedMotion', 'off')
    })
    await expect(slider).toBeEnabled()
  })

  test('configures wheel scroll speed', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const slider = page.getByRole('slider', { name: /Scroll Speed/ })
    await expect(slider).toHaveValue('100')
    await slider.fill('200')
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getScrollSpeed
    })).toBe(200)

    const content = page.locator('.settingsContent')
    await content.evaluate(element => { element.scrollTop = 0 })
    await content.hover({ position: { x: 20, y: 20 } })
    await page.mouse.wheel(0, 120)
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(240)

    await slider.fill('50')
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getScrollSpeed
    })).toBe(50)
    await content.evaluate(element => { element.scrollTop = 0 })
    await content.hover({ position: { x: 20, y: 20 } })
    await page.mouse.wheel(0, 120)
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(60)
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

  test('groups theme selects and keeps restart settings aligned', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const appearance = page.locator('[data-section="appearance"]')
    const theme = appearance.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Theme', exact: true })
    })
    const layout = appearance.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Layout', exact: true })
    })
    const selectRows = theme.locator('.themeSelectRow')
    await expect(selectRows).toHaveCount(3)
    await expect(selectRows.nth(0).locator('.select')).toHaveCount(3)
    await expect(selectRows.nth(1).locator('.select')).toHaveCount(2)
    await expect(selectRows.nth(2).locator('.select')).toHaveCount(3)
    await expect(layout.locator('.themeSelectRow .select')).toHaveCount(2)
    await expect(layout.getByRole('combobox', { name: 'Tab Layout', exact: true })).toBeVisible()
    await expect(layout.getByRole('combobox', { name: 'Tab Loading Style', exact: true })).toBeVisible()

    const baseThemeLabel = selectRows.first().locator('.select').first().locator('.select-label')
    const alignedLabelParts = await baseThemeLabel
      .locator('.select-icon, .select-placeholder, .syncedSettingIndicator, .changedSettingIndicatorPlaceholder')
      .evaluateAll(elements => elements.map(element => {
        const bounds = element.getBoundingClientRect()
        return bounds.y + bounds.height / 2
      }))
    expect(Math.max(...alignedLabelParts) - Math.min(...alignedLabelParts)).toBeLessThanOrEqual(1)

    // These switches share the second column of the row-major layout.
    const switchPositions = await Promise.all([
      'Expand Side Bar by Default',
      'Disable Smooth Scrolling',
      'Show toast timeout indicator'
    ].map(label => page.getByRole('checkbox', { name: label }).boundingBox()))
    const switchX = switchPositions.map(position => position.x)
    expect(Math.max(...switchX) - Math.min(...switchX)).toBeLessThanOrEqual(1)
  })

  test('stacks tab layout controls evenly in a narrow settings window', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 720, height: 700 })
    const appearance = await goToSettingsSection(page, 'appearance')

    const tabLayout = appearance.locator('.themeSelectRow').filter({ hasText: 'Tab Layout' })
    const tabWidth = appearance.locator('.tabSettingsRow .pure-material-slider')
    const loadIcons = appearance.getByRole('button', { name: 'Load Missing Tab Icons' })
    const centerDifference = async () => {
      const centers = await Promise.all([tabLayout, tabWidth, loadIcons].map(async locator => {
        const bounds = await locator.boundingBox()
        return bounds.x + bounds.width / 2
      }))
      return Math.max(...centers) - Math.min(...centers)
    }

    await expect.poll(centerDifference).toBeLessThanOrEqual(3)
    for (const viewport of [
      { width: 375, height: 667 },
      { width: 667, height: 375 },
    ]) {
      await page.setViewportSize(viewport)
      await expect.poll(centerDifference).toBeLessThanOrEqual(3)
    }

    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    await page.setViewportSize({ width: 667, height: 375 })
    await expect.poll(centerDifference).toBeLessThanOrEqual(3)
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

test.describe('dark theme settings', () => {
  test.use({ seed: { settings: { baseTheme: 'dark' } } })

  test('shows the search field against the settings header', async ({ page }) => {
    await goTo(page, 'settings')

    await expect(page.locator('.settingsWindowHeader'))
      .toHaveCSS('background-color', 'rgb(18, 18, 18)')
    const search = page.getByRole('searchbox', { name: 'Search settings' })
    await expect(search).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(search).toHaveCSS('border-style', 'solid')
    await expect(search).toHaveCSS('border-width', '1px')
    const borderColor = await search.evaluate(input => getComputedStyle(input).borderColor)
    expect(borderColor).not.toBe('rgb(18, 18, 18)')
    expect(borderColor).not.toBe('rgba(0, 0, 0, 0)')
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
