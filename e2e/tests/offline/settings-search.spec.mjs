import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'

async function expectSubscriptionRefreshIntervalSelectHighlight(page) {
  await goTo(page, 'settings')
  const search = page.getByRole('searchbox', { name: 'Search settings' })

  await search.fill('Auto Refresh Interval')
  await expect(page.locator('.settingsSearchResultMatch')).toHaveText([
    'Live Auto Refresh Interval',
    'Posts Auto Refresh Interval',
    'Videos Auto Refresh Interval',
    'Shorts Auto Refresh Interval'
  ])
  await page.getByRole('button', { name: 'Videos Auto Refresh Interval', exact: true }).click()

  const selectHighlight = page.locator('.select.settingsSearchTarget')
  const highlightFrame = selectHighlight.locator('.selectSearchHighlightFrame')
  const selectLabel = selectHighlight.locator('.select-label')
  const selectTooltip = selectHighlight.locator('.selectTooltip')
  await expect(selectHighlight).toContainText('Videos Auto Refresh Interval')
  await expect(highlightFrame).toBeVisible()
  await expect(selectLabel).toBeVisible()
  await expect(selectTooltip).toBeVisible()
  await expect(highlightFrame).toHaveCSS('animation-name', /settings-search-highlight/)
  const highlightBounds = await highlightFrame.boundingBox()
  const labelBounds = await selectLabel.boundingBox()
  const tooltipBounds = await selectTooltip.boundingBox()
  expect(highlightBounds).not.toBeNull()
  expect(labelBounds).not.toBeNull()
  expect(tooltipBounds).not.toBeNull()
  expect(highlightBounds.y).toBeLessThanOrEqual(labelBounds.y + 1)
  expect(highlightBounds.x + highlightBounds.width)
    .toBeGreaterThanOrEqual(tooltipBounds.x + tooltipBounds.width)
}

test.describe('settings search category headings', () => {
  for (const { width, height } of [
    { width: 1600, height: 900 },
    { width: 375, height: 812 }
  ]) {
    test.describe(`${width}px viewport`, () => {
      test.use({
        seed: {
          settings: {
            currentLocale: 'en-US',
            bounds: { x: 0, y: 0, width, height, maximized: false }
          }
        }
      })

      test('keeps search results open when clicking a category heading', async ({ page }) => {
        await goTo(page, 'settings')
        const search = page.getByRole('searchbox', { name: 'Search settings' })
        await search.fill('FFmpeg Source')
        const heading = page.locator('.settingsSearchResultHeading')
        const matches = page.locator('.settingsSearchResultMatch')
        await expect(heading).toHaveText('Advanced')
        await expect(matches).toHaveText(['FFmpeg Source'])

        await heading.click()

        await expect(page.locator('.settingsContent > .section')).toHaveCount(0)
        await expect(search).toHaveValue('FFmpeg Source')
        await expect(matches).toHaveText(['FFmpeg Source'])
        await expect(page.getByRole('heading', { name: 'Advanced', level: 2, exact: true })).toBeVisible()
        expect(await heading.evaluate(element => element.tabIndex)).toBe(-1)
        await expect(heading).not.toHaveCSS('cursor', 'pointer')

        await matches.click()
        await expect(page.locator('.settingsContent > [data-section="advanced"]')).toBeVisible()
        await expect(page.locator('.select.settingsSearchTarget')).toContainText('FFmpeg Source')
      })
    })
  }
})

test.describe('lights off settings search', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  for (const query of ['lights off', 'Show Lights Off Toggle']) {
    test(`opens and highlights the visibility toggle for "${query}"`, async ({ page }) => {
      await goTo(page, 'settings')
      const search = page.getByRole('searchbox', { name: 'Search settings' })

      await search.fill(query)
      await expect(page.locator('.settingsSearchResultMatch'))
        .toHaveText(['Show Lights Off Toggle'])
      await page.getByRole('button', { name: 'Show Lights Off Toggle', exact: true }).click()

      const toggle = page.locator('.switch-ctn.settingsSearchTarget')
      await expect(toggle).toContainText('Show Lights Off Toggle')
      await expect(toggle.getByRole('checkbox', { name: 'Show Lights Off Toggle' })).toBeVisible()
      await expect(page.locator('.section.settingsSearchTarget')).toHaveCount(0)
    })
  }
})

test.describe('skip silence settings search', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('opens and highlights the visibility toggle', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    await search.fill('Skip Silence')
    await page.getByRole('button', { name: 'Show Skip Silence Toggle', exact: true }).click()

    await expect(page.locator('.switch-ctn.settingsSearchTarget'))
      .toContainText('Show Skip Silence Toggle')
    await expect(page.locator('.section.settingsSearchTarget')).toHaveCount(0)
  })

  test('opens the default toggle and reflects its dependency', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    await search.fill('Enable Skip Silence by Default')
    await page.getByRole('button', { name: 'Enable Skip Silence by Default', exact: true }).click()

    const defaultToggle = page.getByRole('checkbox', {
      name: /^Enable Skip Silence by Default/
    })
    await expect(defaultToggle).toBeDisabled()

    await page.locator('label.switch-label')
      .filter({ hasText: 'Show Skip Silence Toggle' })
      .click()
    await expect(defaultToggle).toBeEnabled()
  })
})

test.describe('settings search highlights', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test.describe('subpage search', () => {
    test.use({ seed: { settings: { currentLocale: 'en-US', useQuickPlaybackSpeedBar: true } } })

    for (const label of ['Show active subscriptions in sidebar', 'Add item', 'Add Playback Speed', 'Playback Speed']) {
      test(`opens and highlights ${label} inside its subpage`, async ({ page }) => {
        await goTo(page, 'settings')
        await page.getByRole('searchbox', { name: 'Search settings' }).fill(label)
        await page.getByRole('button', { name: label, exact: true }).click()

        const subpage = page.locator('.settingsSubpageScroll:visible')
        const target = subpage.locator('.settingsSearchTarget')
        await expect(subpage).toBeVisible()
        await expect(target).toBeVisible()
        await expect(target).toHaveCSS('animation-name', /settings-search-highlight/)
        if (label === 'Playback Speed') {
          await expect(target).toHaveAccessibleName(label)
        } else {
          await expect(target).toContainText(label)
        }
      })
    }
  })

  test('sizes the actual settings search control at the responsive breakpoint', { tag: '@scale' }, async ({ page, uiScale }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })
    const session = await page.context().newCDPSession(page)

    for (const touch of [true, false]) {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: touch })
      await expect.poll(() => page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(touch)

      for (const width of [1600, 681, 680, 390, 1600]) {
        await page.setViewportSize({ width, height: 800 })
        const compact = await page.evaluate(() => matchMedia('(any-pointer: coarse), (width <= 680px)').matches)
        await expect.poll(async () => search.evaluate(input => input.getBoundingClientRect().height))
          .toBeCloseTo(compact ? 48 : 36, 1)
        const heights = await search.evaluate(input => ({
          input: input.getBoundingClientRect().height,
          wrapper: input.closest('.settingsSearch').getBoundingClientRect().height
        }))
        expect(heights.input).toBeCloseTo(heights.wrapper, 1)
        const header = page.locator('.settingsWindowHeader')
        const spacing = await header.evaluate(element => {
          const header = element.getBoundingClientRect()
          const controls = [...element.querySelectorAll('.settingsSearch, .settingsHeaderButton')]
            .map(control => control.getBoundingClientRect())
          return Math.min(...controls.flatMap(control => [
            control.top - header.top,
            header.bottom - control.bottom
          ]))
        })
        const inputMode = touch ? 'touch' : 'mouse'
        expect(spacing, `${inputMode} ${width}px clearance`).toBeCloseTo(width === 1600 ? 6.5 : 5, 0)
        if (width === 1600 && !touch) {
          expect((await header.boundingBox()).height).toBeCloseTo(52, 0)
        }
        if (uiScale === 100) {
          if (width === 1600) await header.screenshot({ path: testInfo.outputPath(`settings-header-${inputMode}-desktop.png`) })
          if (width === 390) await page.screenshot({ path: testInfo.outputPath(`settings-search-${inputMode}-mobile.png`) })
        }
      }
    }
  })

  test('keeps settings icons above a full-width search when they fit', { tag: '@scale' }, async ({ page, uiScale }, testInfo) => {
    // Keep a 460 CSS px layout, where the icons fit, at every UI scale.
    await page.setViewportSize({ width: Math.round(460 * uiScale / 100), height: 800 })
    await goTo(page, 'settings')
    const header = page.locator('.settingsWindowHeader')
    await expect.poll(() => header.evaluate(element => {
      const title = element.querySelector('.settingsHeaderNavigation').getBoundingClientRect()
      const actions = element.querySelector('.settingsHeaderActions').getBoundingClientRect()
      return Math.abs(title.y + title.height / 2 - actions.y - actions.height / 2)
    })).toBeLessThanOrEqual(1)
    const bounds = await header.evaluate(element => {
      const header = element.getBoundingClientRect()
      const search = element.querySelector('.settingsSearch').getBoundingClientRect()
      const actions = element.querySelector('.settingsHeaderActions').getBoundingClientRect()
      return { left: search.left - header.left, right: header.right - search.right, searchTop: search.top, actionsBottom: actions.bottom }
    })
    expect(bounds.left).toBeCloseTo(10, 0)
    expect(bounds.right).toBeCloseTo(10, 0)
    expect(bounds.searchTop).toBeGreaterThanOrEqual(bounds.actionsBottom)
    if (uiScale === 100) {
      await page.screenshot({ path: testInfo.outputPath('settings-restored-full-width-search.png') })
    }
  })

  test('uses the shared search field focus indicator without a second outline', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    await expect(search).toBeFocused()
    await expect(search).toHaveCSS('outline-style', 'none')
    await expect(search).toHaveCSS('box-shadow', /inset/)
    await expect(search).toHaveCSS('border-style', 'solid')
  })

  test('finds and highlights specific subscription refresh interval selects', { tag: '@scale' }, async ({ page }) => {
    await expectSubscriptionRefreshIntervalSelectHighlight(page)
  })

  test('opens the videos auto refresh interval setting', async ({ page }) => {
    const settings = await goToSettingsSection(page, 'subscription')
    const interval = settings.getByRole('combobox', { name: 'Videos Auto Refresh Interval' })
    await interval.click()
    await expect(interval).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('listbox', { name: 'Videos Auto Refresh Interval' })).toBeVisible()
  })

  test('highlights a category opened through its description', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    await search.fill('Feed refresh and display options')
    await page.getByRole('button', { name: 'Feed refresh and display options', exact: true }).click()

    const sectionHighlight = page.locator('.section.settingsSearchTarget')
    await expect(sectionHighlight).toHaveAttribute('data-section', 'subscriptions')
    await expect(sectionHighlight).toHaveCSS('animation-name', /settings-search-highlight/)
  })

  test('highlights a whole settings subsection opened through its heading', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    await search.fill('Context Menu Search')
    await page.getByRole('button', { name: 'Context Menu Search', exact: true }).click()

    const contextMenuSearchSection = page.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Context Menu Search', exact: true })
    })
    await expect(contextMenuSearchSection).toHaveClass(/settingsSearchTarget/)
    await expect(contextMenuSearchSection)
      .toHaveCSS('animation-name', /settings-search-highlight/)
  })

  for (const { searchTerm, sectionType, settingLabel } of [{
    searchTerm: 'Subscription',
    sectionType: 'subscriptions',
    settingLabel: 'Fetch Feed on Startup'
  }, {
    searchTerm: 'Caption Appearance',
    sectionType: 'playback',
    settingLabel: 'Preferred Caption Language'
  }]) {
    test(`highlights the subsection represented by the hidden ${searchTerm} title`, async ({ page }) => {
      await goTo(page, 'settings')
      const search = page.getByRole('searchbox', { name: 'Search settings' })

      await search.fill(searchTerm)
      await page.getByRole('button', { name: searchTerm, exact: true }).click()

      const subsectionHighlight = page.locator(
        `.section[data-section="${sectionType}"] .settingsSection.settingsSearchTarget`
      )
      await expect(subsectionHighlight).toContainText(settingLabel)
      await expect(subsectionHighlight).toHaveCSS('animation-name', /settings-search-highlight/)
    })
  }

  test('does not search input placeholders or feedback messages', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    for (const searchTerm of [
      'Engine name',
      'Search URL',
      'Search history and cache have been cleared',
      'Generated SponsorBlock user ID copied to clipboard',
      'Syncing watch history',
      'This server version does not support watch history syncing'
    ]) {
      await search.fill(searchTerm)
      await expect(page.locator('.settingsNoResults')).toBeVisible()
      await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)
    }
  })

  test('only searches controls while their settings are visible', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    for (const searchTerm of [
      'Screenshot Mode',
      'Edge Color',
      'Server URL',
      'Executable path',
      'SponsorBlock API URL',
      'API URL',
      'Proxy Host',
      'Edit custom theme',
      'Remove Password',
      'Generated SponsorBlock User ID',
      'Reveal Generated User ID'
    ]) {
      await search.fill(searchTerm)
      await expect(page.locator('.settingsNoResults')).toBeVisible()
      await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0, { timeout: 1_000 })
    }

    await search.fill('')
    const playback = await goToSettingsSection(page, 'playback')
    await playback.locator('label.switch-label').filter({ hasText: 'Enable Screenshot' }).click()
    await playback.getByRole('combobox', { name: 'Edge Style' }).click()
    await page.getByRole('option', { name: 'Outline', exact: true }).click()

    for (const searchTerm of ['Screenshot Mode', 'Edge Color']) {
      await search.fill(searchTerm)
      await expect(page.getByRole('button', { name: searchTerm, exact: true })).toBeVisible()
    }
  })
})

test.describe('settings', () => {
  test('focuses its search and closes with Escape', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })
    await expect(search).toBeFocused()
    await search.evaluate(element => element.blur())
    await search.click()
    await expect(search).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.locator('.settingsWindow')).toBeHidden()
  })

  test('searches setting labels and opens their category', async ({ page }) => {
    await page.evaluate(() => window.$store.dispatch('updateCurrentLocale', 'en-US'))
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })
    await expect(search).toBeVisible()

    await search.fill('update')
    await expect(page.locator('.settingsMenu .title.active')).toHaveCount(0)
    await expect(page.locator('.settingsContent > .section')).toHaveCount(0)
    await expect(page.locator('.settingsSearchResult')).toHaveCount(1)
    expect(await page.locator('.settingsMenu .title').evaluateAll(elements => (
      elements.every(element => element.scrollHeight <= element.clientHeight + 1)
    ))).toBe(true)

    await search.fill('a')
    const searchContent = page.locator('.settingsContent')
    const searchScrollbar = searchContent.locator(':scope > .os-scrollbar-vertical')
    await searchContent.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => searchContent.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(searchScrollbar).not.toHaveClass(/os-scrollbar-unusable/)

    await search.fill('FFmpeg Source')
    await expect.poll(() => searchContent.evaluate(element => element.scrollTop)).toBe(0)
    await expect.poll(() => searchContent.evaluate(
      element => element.scrollHeight <= element.clientHeight + 1
    )).toBe(true)
    await expect(searchScrollbar).toHaveClass(/os-scrollbar-unusable/)
    await expect(page.locator('.settingsMenu .title')).toHaveCount(1)
    await expect(page.locator('.settingsMenu [data-section="advanced"]')).toBeVisible()
    await expect(page.locator('.settingsSearchResult')).toContainText('FFmpeg Source')
    await page.getByRole('button', { name: 'FFmpeg Source', exact: true }).click()
    await expect(page.locator('.settingsContent > [data-section="advanced"]')).toBeVisible()
    await expect(page.locator('.settingsBreadcrumbCategoryIcon[data-icon="flask"]')).toBeVisible()
    await expect(page.locator('.select.settingsSearchTarget')).toContainText('FFmpeg Source')
    await expect(page.locator('.section.settingsSearchTarget')).toHaveCount(0)

    await search.fill('Check for Updates')
    await page.getByRole('button', { name: /Check for updates/i, exact: true }).click()
    const switchHighlight = page.locator('.switch-ctn.settingsSearchTarget')
    await expect(switchHighlight).toContainText(/Check for updates/i)
    const { borderRadius, uiRoundness } = await switchHighlight.evaluate(element => {
      const style = getComputedStyle(element)
      return {
        borderRadius: Number.parseFloat(style.borderRadius),
        uiRoundness: Number.parseFloat(style.getPropertyValue('--ui-roundness'))
      }
    })
    expect(borderRadius).toBeCloseTo(4 * uiRoundness)
    await expect(page.locator('.section.settingsSearchTarget')).toHaveCount(0)

    await search.fill('UI Scale')
    await page.getByRole('button', { name: 'UI Scale', exact: true }).click()
    await expect(page.locator('.pure-material-slider.settingsSearchTarget')).toContainText('UI Scale')
    await expect(page.locator('.section.settingsSearchTarget')).toHaveCount(0)

    await search.fill('Region for Trending')
    await page.getByRole('button', { name: /Region for trending/i }).click()
    await expect(page.locator('.settingsSearchTarget')).toContainText(/Region for trending/i)
    await expect.poll(() => page.locator('.settingsContent').evaluate(element => element.scrollTop))
      .toBeGreaterThan(0)

    await search.fill('External Player')
    await page.locator('.settingsSearchResultMatch')
      .filter({ hasText: /^External Player$/ })
      .click()
    await expect(page.locator('.settingsSearchTarget.select')).toBeVisible()

    await page.getByRole('combobox', { name: 'External Player', exact: true }).click()
    await page.getByRole('option', { name: 'mpv', exact: true }).click()
    await search.fill('Executable path')
    await page.getByRole('button', { name: 'Executable path', exact: true }).click()
    const executableHighlight = page.locator('input.settingsSearchTarget')
    await expect(executableHighlight).toHaveAccessibleName('Executable path')
    expect(await executableHighlight.evaluate(element => getComputedStyle(element).animationName))
      .toContain('settings-search-highlight')
    expect((await executableHighlight.boundingBox()).height).toBeLessThanOrEqual(56.01)
    await expect(page.locator('.ft-input-component.settingsSearchTarget')).toHaveCount(0)

    await search.fill('Proxy Videos Through Invidious')
    await expect(page.locator('.settingsMenu [data-section="advanced"]')).toBeVisible()
    await page.getByRole('button', { name: 'Proxy Videos Through Invidious', exact: true }).click()
    await expect(page.locator('.settingsContent > [data-section="advanced"]')).toBeVisible()
    const providerSection = page.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Video and metadata providers', exact: true })
    })
    await expect(providerSection.locator('.switch-ctn.settingsSearchTarget'))
      .toContainText('Proxy Videos Through Invidious')

    await search.fill('test')
    await expect(page.getByRole('button', { name: 'Test Proxy', exact: true })).toHaveCount(0)
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    const proxyInfo = 'Clicking on Test Proxy will send a request to ' +
      'https://ipwho.is/?output=json&fields=ip,country,city,region&lang=en'
    await search.fill(proxyInfo)
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('Manage Saved Channels')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('How do I import my subscriptions?')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('successfully imported')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('checking')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('No default instance has been set')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('Current instance will be randomized on startup')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('Catppuccin Latte')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('Application Language')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveCount(0)

    await search.fill('Preferred Caption Language')
    await expect(page.locator('.settingsMenu [data-section="playback"]')).toBeVisible()
    await page.getByRole('button', { name: 'Preferred Caption Language', exact: true }).click()
    await expect(page.locator('.select.settingsSearchTarget'))
      .toContainText('Preferred Caption Language')

    await search.fill('Base Theme')
    await expect(page.getByRole('button', { name: /^Base theme$/i })).toBeVisible()

    await search.fill('Default Landing Page')
    await page.getByRole('button', { name: /^Default landing page$/i }).click()
    const landingPageSelect = page.getByRole('combobox', { name: /Default landing page/i })
    await landingPageSelect.click()
    await expect(page.getByRole('option', { name: 'Settings', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await search.fill('no setting has this name')
    await expect(page.locator('.settingsMenu')).toContainText('No settings found')
    await expect(page.locator('.settingsContent')).toContainText('No settings found')
  })
})

test.describe('grid columns settings search', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('opens and highlights the grid column select', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    await search.fill('playlist grid')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveText(['Playlist Grid Columns'])
    await search.fill('grid columns')
    await expect(page.locator('.settingsSearchResultMatch')).toHaveText(['Grid Columns'])
    await page.getByRole('button', { name: 'Grid Columns', exact: true }).click()

    await expect(page.locator('.settingsSearchTarget')).toContainText('Grid Columns')
    await expect(page.getByRole('combobox', { name: 'Grid Columns', exact: true })).toBeVisible()
  })
})
