import { test, expect, goTo } from '../../helpers/app.mjs'

test.describe('settings search category headings', () => {
  for (const { width, height } of [
    { width: 1600, height: 900 }
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

test.describe('settings search in a partially translated locale', () => {
  // en-GB lacks this label, so the select renders the en-US fallback.
  test.use({ seed: { settings: { currentLocale: 'en-GB' } } })

  test('finds settings that use the en-US fallback label', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })

    await search.fill('Title Lines')
    await expect(page.locator('.settingsSearchResultMatch'))
      .toHaveText(['Title Lines'])
    await page.getByRole('button', { name: 'Title Lines', exact: true }).click()
    await expect(page.locator('.select.settingsSearchTarget')).toContainText('Title Lines')
  })
})

test.describe('settings search highlights', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test.describe('subpage search', () => {
    test.use({ seed: { settings: { currentLocale: 'en-US', useQuickPlaybackSpeedBar: true } } })

    for (const label of ['Show active subscriptions in sidebar', 'Playback Speed']) {
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

    // Tabbed categories hide their headings, so a tab's label highlights its panel.
    await search.fill('YouTube Account')
    await page.getByRole('button', { name: 'YouTube Account', exact: true }).click()
    await expect(page.locator('.settingsWindow [data-settings-tab="youtube-account"]'))
      .toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.section.settingsSearchTarget[data-section="sync"]')).toBeVisible()

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
