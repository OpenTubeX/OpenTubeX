import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { DBActions } from '../../../src/constants.js'
import {
  test,
  expect,
  expectAnimation,
  goTo,
  goToSettingsSection,
  latestSettings,
  recordAnimations,
  sel,
  waitForAppReady
} from '../../helpers/app.mjs'

async function expectCompactCustomThemeEditor(page) {
  const appearance = await goToSettingsSection(page, 'appearance')
  await appearance.getByRole('button', { name: 'Create custom theme' }).click()

  const editor = page.locator('.customThemeEditor')
  await expect(editor.locator('.themeNameField > input')).toBeVisible()

  const spacing = await editor.evaluate(element => {
    const contentBounds = element.closest('.settingsSubpageScroll').getBoundingClientRect()
    const nameFieldBounds = element.querySelector('.themeNameField').getBoundingClientRect()
    const buttonBounds = element.querySelector('.editorFooter .btn:last-child').getBoundingClientRect()
    return {
      top: nameFieldBounds.top - contentBounds.top,
      bottom: contentBounds.bottom - buttonBounds.bottom
    }
  })

  expect(spacing.top).toBeLessThanOrEqual(12)
  expect(spacing.bottom).toBeLessThanOrEqual(12)
}

async function expectAlwaysVisibleScrollbarsToPreserveSettingsScroll(page) {
  await goToSettingsSection(page, 'appearance')
  const content = page.locator('.settingsContent')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const toggle = page.locator('label.switch-label').filter({ hasText: 'Always Show Scrollbars' })
  await toggle.scrollIntoViewIfNeeded()
  const scrollTop = await content.evaluate(element => element.scrollTop)

  await toggle.click()
  await expect(page.getByRole('checkbox', { name: 'Always Show Scrollbars' })).toBeChecked()
  await expect.poll(async () => Math.abs(
    await content.evaluate(element => element.scrollTop) - scrollTop
  )).toBeLessThanOrEqual(1)
}

async function expectMinimizeToPreserveSettingsScroll(page) {
  await goToSettingsSection(page, 'appearance')
  const content = page.locator('.settingsContent')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const scrollTop = await content.evaluate(element => element.scrollTop)

  const settingsWindow = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settingsWindow.getByRole('button', { name: /Minimi[sz]e/ }).click()
  await expect(settingsWindow).toBeHidden()
  await page.getByRole('button', { name: 'Restore: Settings' }).click()
  await expect(settingsWindow).toBeVisible()

  await expect.poll(async () => Math.abs(
    await content.evaluate(element => element.scrollTop) - scrollTop
  )).toBeLessThanOrEqual(1)
}

async function expectExternalSoftwarePathAlignment(tool, sourceName, pathPlaceholder) {
  const source = tool.locator('.select').filter({ hasText: sourceName })
  const [sourceBox, helpBox, pathBox] = await Promise.all([
    source.locator('.select-text').boundingBox(),
    source.locator('.selectIndicators button').boundingBox(),
    tool.getByPlaceholder(pathPlaceholder).boundingBox()
  ])

  expect(sourceBox).not.toBeNull()
  expect(helpBox).not.toBeNull()
  expect(pathBox).not.toBeNull()
  expect(pathBox.x).toBeCloseTo(sourceBox.x, 0)
  expect(pathBox.x + pathBox.width).toBeCloseTo(helpBox.x + helpBox.width, 0)
}

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
  expect(highlightBounds.y).toBeLessThanOrEqual(labelBounds.y)
  expect(highlightBounds.x + highlightBounds.width)
    .toBeGreaterThanOrEqual(tooltipBounds.x + tooltipBounds.width)
}

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
})

test.describe('settings search highlights', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('finds and highlights specific subscription refresh interval selects', async ({ page }) => {
    await expectSubscriptionRefreshIntervalSelectHighlight(page)
  })

  test.describe('at 95% UI scale', () => {
    test.use({ seed: { settings: { currentLocale: 'en-US', uiScale: 95 } } })

    test('keeps the select highlight around its label and help icon', async ({ page }) => {
      await expectSubscriptionRefreshIntervalSelectHighlight(page)
    })
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
      'Generated SponsorBlock user ID copied to clipboard'
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
      'Custom External Player Executable',
      'SponsorBlock API Url (Default is https://sponsor.ajay.app)',
      'Return YouTube Dislike API URL (Default is https://ryd-proxy.kavin.rocks)',
      'Proxy Host',
      'Edit custom theme',
      'Remove Password',
      'Generated SponsorBlock User ID',
      'Export Generated User ID'
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
      .toHaveText('History, stored data, and access controls')
  })

  test('keeps the IP block recovery script last in expanded Proxy settings', async ({ page }) => {
    const advanced = await goToSettingsSection(page, 'advanced')
    const proxy = advanced.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Proxy', exact: true })
    })

    await proxy.locator('label.switch-label').filter({ hasText: 'Enable Tor / Proxy' }).click()
    const [testProxyBox, recoveryScriptBox] = await Promise.all([
      proxy.getByRole('button', { name: 'Test Proxy', exact: true }).boundingBox(),
      proxy.getByPlaceholder('IP Block Recovery Script Path').boundingBox()
    ])

    expect(testProxyBox).not.toBeNull()
    expect(recoveryScriptBox).not.toBeNull()
    expect(recoveryScriptBox.y).toBeGreaterThan(testProxyBox.y)
    expect(recoveryScriptBox.y - (testProxyBox.y + testProxyBox.height))
      .toBeGreaterThanOrEqual(16)
  })

  test('keeps each external tool grouped when its source changes', async ({ app, page }) => {
    await app.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('yt-dlp-get-info')
      ipcMain.handle('yt-dlp-get-info', (_event, options) => ({
        ytDlp: {
          source: options.ytDlpSource,
          available: true,
          version: '2026.08.19',
          supportedBrowsers: []
        },
        ffmpeg: { source: options.ffmpegSource, available: true, version: '8.0' },
        ffprobe: { source: options.ffmpegSource, available: true, version: '8.0' }
      }))
    })

    const advanced = await goToSettingsSection(page, 'advanced')
    const externalSoftware = advanced.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'External Software', exact: true })
    })
    const tools = externalSoftware.locator('.externalSoftwareTool')
    const ytDlpTool = tools.nth(0)
    const ffmpegTool = tools.nth(1)

    await expect(tools.locator('.externalSoftwareToolTitle')).toHaveText([
      'yt-dlp',
      'FFmpeg / FFprobe'
    ])
    await expect(ytDlpTool.getByRole('combobox', { name: 'yt-dlp Source' })).toBeVisible()
    await expect(ytDlpTool.getByPlaceholder('yt-dlp Executable Path')).toBeVisible()
    await expect(ffmpegTool.getByRole('combobox', { name: 'FFmpeg Source' })).toBeVisible()
    await expect(ffmpegTool.getByPlaceholder('FFmpeg Executable Path')).toBeVisible()

    const ytDlpSource = ytDlpTool.locator('.select').filter({ hasText: 'yt-dlp Source' })
    const ffmpegSource = ffmpegTool.locator('.select').filter({ hasText: 'FFmpeg Source' })
    await expect(ytDlpSource.locator('.select-icon')).toHaveCount(0)
    await expect(ffmpegSource.locator('.select-icon')).toHaveCount(0)
    await expectExternalSoftwarePathAlignment(
      ytDlpTool,
      'yt-dlp Source',
      'yt-dlp Executable Path'
    )
    await expectExternalSoftwarePathAlignment(
      ffmpegTool,
      'FFmpeg Source',
      'FFmpeg Executable Path'
    )
    const positionWithinTool = source => source.evaluate(element => {
      const sourceBounds = element.getBoundingClientRect()
      const toolBounds = element.closest('.externalSoftwareTool').getBoundingClientRect()
      return {
        x: sourceBounds.x - toolBounds.x,
        y: sourceBounds.y - toolBounds.y
      }
    })
    const positionsBefore = await Promise.all([
      positionWithinTool(ytDlpSource),
      positionWithinTool(ffmpegSource)
    ])

    await ytDlpSource.locator('select').selectOption('managed')
    await expect(ytDlpTool.getByRole('combobox', { name: 'yt-dlp Channel' })).toBeVisible()
    await expect(ytDlpTool.getByPlaceholder('yt-dlp Executable Path')).toHaveCount(0)
    await expect(ytDlpTool.getByRole('button', { name: 'Update yt-dlp' })).toBeVisible()
    await expect(ffmpegTool.getByPlaceholder('FFmpeg Executable Path')).toBeVisible()

    const positionsAfter = await Promise.all([
      positionWithinTool(ytDlpSource),
      positionWithinTool(ffmpegSource)
    ])
    for (const index of [0, 1]) {
      expect(positionsAfter[index].x).toBeCloseTo(positionsBefore[index].x, 0)
      expect(positionsAfter[index].y).toBeCloseTo(positionsBefore[index].y, 0)
    }

    await ffmpegSource.locator('select').selectOption('managed')
    await expect(ffmpegTool.getByPlaceholder('FFmpeg Executable Path')).toHaveCount(0)
    await expect(ffmpegTool.getByRole('button', { name: 'Update FFmpeg and FFprobe' })).toBeVisible()
    await expect(externalSoftware.getByRole('combobox', { name: 'Managed Tool Updates' })).toBeVisible()
  })

  test.describe('external software at 95% UI scale', () => {
    test.use({
      seed: {
        settings: {
          uiScale: 95,
          ytDlpSource: 'system',
          ytDlpFfmpegSource: 'system'
        }
      }
    })

    test('aligns path inputs with source controls when the cards stack', async ({ page }) => {
      await page.setViewportSize({ width: 1000, height: 800 })
      const advanced = await goToSettingsSection(page, 'advanced')
      const tools = advanced.locator('.externalSoftwareTool')
      const [ytDlpBox, ffmpegBox] = await Promise.all([
        tools.nth(0).boundingBox(),
        tools.nth(1).boundingBox()
      ])

      expect(ffmpegBox.y).toBeGreaterThan(ytDlpBox.y + ytDlpBox.height)

      await expectExternalSoftwarePathAlignment(
        tools.nth(0),
        'yt-dlp Source',
        'yt-dlp Executable Path'
      )
      await expectExternalSoftwarePathAlignment(
        tools.nth(1),
        'FFmpeg Source',
        'FFmpeg Executable Path'
      )
    })
  })

  test('shows yt-dlp browsers dynamically and centers the optional profile field', async ({ app, page }) => {
    await app.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('yt-dlp-get-info')
      ipcMain.handle('yt-dlp-get-info', (_event, options) => ({
        ytDlp: {
          source: options.ytDlpSource,
          available: true,
          version: 'test',
          supportedBrowsers: ['firefox', 'vivaldi']
        },
        ffmpeg: { source: options.ffmpegSource, available: true, version: 'test' },
        ffprobe: { source: options.ffmpegSource, available: true, version: 'test' }
      }))
    })

    const advanced = await goToSettingsSection(page, 'advanced')
    const authentication = advanced.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: 'Restricted Video Authentication', exact: true })
    })
    const cookieSource = authentication.locator('.restrictedPlaybackAuthSource select')

    await expect(cookieSource.locator('option')).toHaveText(['None', 'File', 'Browser'])
    await cookieSource.selectOption('browser')

    const browser = authentication.locator('.restrictedPlaybackAuthDetail select')
    await expect(browser.locator('option')).toHaveText([
      'Select a browser',
      'Firefox',
      'Vivaldi'
    ])
    await browser.selectOption('firefox')

    const profile = authentication.getByPlaceholder('Profile name or path')
    await profile.fill('/tmp/firefox-profile')

    const [sourceBox, browserBox, profileBox] = await Promise.all([
      authentication.locator('.restrictedPlaybackAuthSource .select').boundingBox(),
      authentication.locator('.restrictedPlaybackAuthDetail .select').boundingBox(),
      authentication.locator('.restrictedPlaybackBrowserProfile .ft-input-component').boundingBox()
    ])
    expect(sourceBox).not.toBeNull()
    expect(browserBox).not.toBeNull()
    expect(profileBox).not.toBeNull()

    const upperCenter = (
      sourceBox.x + sourceBox.width / 2 +
      browserBox.x + browserBox.width / 2
    ) / 2
    expect(Math.abs(profileBox.x + profileBox.width / 2 - upperCenter)).toBeLessThanOrEqual(1)
    expect(profileBox.y).toBeGreaterThan(Math.max(
      sourceBox.y + sourceBox.height,
      browserBox.y + browserBox.height
    ))

    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return {
        mode: settings.ytDlpPlaybackAuthMode,
        browser: settings.ytDlpPlaybackCookiesBrowser,
        profile: settings.ytDlpPlaybackCookiesBrowserProfile
      }
    }).toEqual({
      mode: 'browser',
      browser: 'firefox',
      profile: '/tmp/firefox-profile'
    })
  })

  test('puts theme controls before a separate Layout section', async ({ page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    const headings = appearance.getByRole('heading', { level: 3 })

    await expect(headings).toHaveText(['Theme', 'Layout', 'Video lists and thumbnails'])
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

  test('keeps the custom theme editor compact', async ({ page }) => {
    await expectCompactCustomThemeEditor(page)
  })

  test.describe('at 95% UI scale', () => {
    test.use({ seed: { settings: { uiScale: 95 } } })

    test('keeps the custom theme editor compact', async ({ page }) => {
      await expectCompactCustomThemeEditor(page)
    })
  })

  test('caps the width of the download action buttons', async ({ page }) => {
    const downloads = await goToSettingsSection(page, 'download')
    const enableDownloads = downloads.getByRole('checkbox', { name: 'Enable Downloads' })
    if (!await enableDownloads.isChecked()) {
      await downloads.locator('label.switch-label').filter({ hasText: 'Enable Downloads' }).click()
    }

    const buttons = downloads.locator('.downloadActions .btn')
    await expect(buttons).toHaveCount(3)
    const widths = await buttons.evaluateAll(elements => (
      elements.map(element => element.getBoundingClientRect().width)
    ))
    expect(Math.max(...widths)).toBeLessThanOrEqual(300)
  })

  test('hides the redundant Privacy heading and keeps the original Distraction Free headings', async ({ page }) => {
    const privacy = await goToSettingsSection(page, 'privacy')
    const mainPrivacySection = privacy.locator('.settingsSection').first()
    const privacyHeading = mainPrivacySection.locator('.sectionTitle')
    await expect(privacyHeading).toHaveText('Privacy')
    await expect(privacyHeading).not.toBeVisible()

    const metadataToggle = page.getByRole('checkbox', { name: 'Metadata history' })
    const metadataSection = privacy.locator('.settingsSection').filter({ has: metadataToggle })
    await expect(metadataSection).toBeVisible()
    await expect(metadataSection.getByRole('heading', { name: 'Metadata history' })).toHaveCount(0)
    await expect(metadataToggle).toBeVisible()
    await expect(metadataSection.getByText(/^Video metadata cache:/)).toBeVisible()
    await expect(mainPrivacySection.getByRole('checkbox', { name: 'Metadata history' }))
      .toHaveCount(0)

    const focus = await goToSettingsSection(page, 'focus')
    await expect(focus.locator('h4.groupTitle')).toHaveText([
      'General',
      'Visible While Paused in Full Window / Full Screen',
      'Side bar',
      'Subscriptions page',
      'Channel Page',
      'Watch Page'
    ])
  })

  test('keeps General help icons close to their selects', async ({ page }) => {
    await goTo(page, 'settings')
    const startup = page.locator('.generalSelectGrid .select').filter({ hasText: 'On Startup' })
    const gaps = await startup.evaluate(element => {
      const select = element.querySelector('.select-text').getBoundingClientRect()
      const tooltip = element.querySelector('.selectTooltip').getBoundingClientRect()
      const root = element.getBoundingClientRect()
      return {
        before: tooltip.left - select.right,
        after: root.right - tooltip.right,
      }
    })

    expect(gaps.before).toBeLessThanOrEqual(16)
    expect(gaps.after).toBeLessThanOrEqual(16)
  })

  test('keeps SponsorBlock category colors in its flexible layout', async ({ page }) => {
    const addOns = await goToSettingsSection(page, 'add-ons')
    await addOns.locator('label.switch-label').filter({ hasText: 'Enable SponsorBlock' }).click()

    const categories = addOns.locator('.sponsorBlockCategory')
    await expect(categories).toHaveCount(10)
    expect(await categories.first().locator('..').evaluate(element => (
      getComputedStyle(element).display
    ))).toBe('flex')

    const paletteColors = await categories.evaluateAll(elements => elements.slice(0, 2).map(element => (
      getComputedStyle(element.querySelector('.select-icon')).color
    )))
    expect(paletteColors).toEqual(['rgb(76, 175, 80)', 'rgb(255, 235, 59)'])
  })

  test('offers a custom SponsorBlock category color initialized from its default', async ({ app, page }) => {
    const addOns = await goToSettingsSection(page, 'add-ons')
    await addOns.locator('label.switch-label').filter({ hasText: 'Enable SponsorBlock' }).click()

    const sponsorCategory = addOns.locator('.sponsorBlockCategory')
      .filter({ has: page.locator('.sponsorTitle', { hasText: /^Sponsor$/ }) })
    const colorSelect = sponsorCategory.locator('.select-text').first()
    await colorSelect.click()

    const colorOptions = page.locator('.selectDropdown .selectOption')
    await expect(colorOptions.first()).toHaveText('Custom color')
    await colorOptions.first().click()

    const picker = sponsorCategory.locator('.ftColorPicker')
    await expect(picker.getByRole('button', { name: 'Custom color' })).toBeVisible()
    await expect(picker.locator('code')).toHaveText('#4caf50')
    await expect(sponsorCategory.locator('.select-icon').first())
      .toHaveCSS('color', 'rgb(76, 175, 80)')

    await picker.getByRole('button', { name: 'Custom color' }).click()
    const pickerDialog = page.getByRole('dialog', { name: 'Custom color' })
    const hexColor = pickerDialog.getByLabel('Hex color')
    await hexColor.fill('#123456')
    await hexColor.press('Enter')
    await pickerDialog.getByRole('button', { name: 'Apply' }).click()

    await expect(picker.locator('code')).toHaveText('#123456')
    await expect(sponsorCategory.locator('.select-icon').first())
      .toHaveCSS('color', 'rgb(18, 52, 86)')
    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return settings.sponsorBlockSponsor
    }).toEqual({ color: '#123456', skip: 'autoSkip' })
  })

  test('keeps General selects compact with tooltip indicators inside their width', async ({ page, attachScreenshot }) => {
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
      }
    })

    expect(measurements.gridWidth).toBeLessThanOrEqual(700)
    expect(measurements.centerOffset).toBeLessThanOrEqual(1)
    expect(measurements.maximumSelectWidth - measurements.minimumSelectWidth).toBeLessThanOrEqual(1)
    await attachScreenshot('compact General setting selects')
  })

  test('keeps General selects compact in the one-column layout', async ({ page }) => {
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
        columnCount: getComputedStyle(element).gridTemplateColumns.split(' ').length,
        gridWidth: gridBounds.width,
        maximumSelectWidth: Math.max(...selectWidths),
        centerOffset: Math.abs(
          gridBounds.left + gridBounds.width / 2 -
          (contentBounds.left + contentBounds.width / 2)
        )
      }
    })

    expect(measurements.columnCount).toBe(1)
    expect(measurements.gridWidth).toBeLessThanOrEqual(330)
    expect(measurements.maximumSelectWidth).toBeLessThanOrEqual(330)
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

    for (const sectionType of ['subscriptions', 'focus', 'privacy']) {
      await page.locator(`.settingsMenu [data-section="${sectionType}"]`).click()
      const grids = page.locator(
        `.settingsContent > [data-section="${sectionType}"] .switchColumnGrid`
      )
      await expect(grids.first()).toBeVisible()

      const centerOffsets = await grids.evaluateAll(elements => elements.flatMap(grid => {
        const gridBounds = grid.getBoundingClientRect()
        const gridCenter = gridBounds.left + gridBounds.width / 2
        return Array.from(grid.querySelectorAll(':scope > .switchColumn')).flatMap(column => {
          return Array.from(column.children)
            .map(child => child.getBoundingClientRect())
            .filter(bounds => bounds.width > 0 && bounds.height > 0)
            .map(bounds => Math.abs(bounds.left + bounds.width / 2 - gridCenter))
        })
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
    await expect(general.getByText(/^Auto load next page$/i)).toBeVisible()

    const privacyCategory = await goToSettingsSection(page, 'privacy')
    const privacy = privacyCategory.locator('.settingsSection').first()

    await expect(privacyCategory.getByRole('heading', {
      name: 'Online activity',
      exact: true
    })).toHaveCount(0)
    await expect(privacyCategory.getByText(/^Auto load next page$/i)).toHaveCount(0)
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

  test('keeps General settings aligned to the bottom of its scroll range', async ({ page }) => {
    await goTo(page, 'settings')
    const content = page.locator('.settingsContent')
    await expect(content).toBeVisible()
    await content.hover()
    await page.mouse.wheel(0, 2000)

    await expect.poll(() => content.evaluate((element) => {
      const lastSection = element.querySelector('.settingsCategory > :last-child')
      return element.getBoundingClientRect().bottom - lastSection.getBoundingClientRect().bottom
    })).toBeLessThanOrEqual(45)
  })

  test('renders without flashing native scrollbars', async ({ page }) => {
    await goTo(page, 'settings')

    await expect(page.locator('.settingsContent > .section')).toHaveCount(1)
    await expect(page.locator('.settingsContent .os-scrollbar-vertical')).toHaveCount(1)
    await expect(page.locator('.settingsContent')).toHaveCSS('scrollbar-width', 'none')
  })

  test('opens over the current page and renders the selected section', async ({ page, attachScreenshot }) => {
    const url = page.url()
    const activeTab = await page.locator(sel.activeTab).textContent()

    await goTo(page, 'settings')

    await expect(page).toHaveURL(url)
    await expect(page.locator(sel.activeTab)).toContainText(activeTab)
    const windowIcon = page.locator('.settingsWindowIcon')
    const breadcrumbLabel = page.locator('.settingsBreadcrumbLabel').first()
    await expect(windowIcon).toBeVisible()
    await expect(windowIcon).toHaveAttribute('data-icon', 'gear')
    await expect(page.locator('.settingsBreadcrumbCategoryIcon')).toBeVisible()
    const [iconBounds, labelBounds] = await Promise.all([
      windowIcon.boundingBox(),
      breadcrumbLabel.boundingBox()
    ])
    // Within a pixel rather than toBeCloseTo's half: both boxes land on
    // fractional pixels on scaled displays, which is not a misalignment.
    const iconCenter = iconBounds.y + iconBounds.height / 2
    const labelCenter = labelBounds.y + labelBounds.height / 2
    expect(Math.abs(iconCenter - labelCenter)).toBeLessThanOrEqual(1)
    await expect(page.getByRole('button', {
      name: 'Highlight settings changed from defaults'
    }).locator('[data-icon="pen"]')).toBeVisible()
    await expect(page.locator('.settingsMenu')).toBeVisible()
    await expect(page.locator('.settingsContent > [data-section="general"]')).toBeVisible()
    await attachScreenshot('settings window over the page')
  })

  test('opens from Preferences without remounting the current feed', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    const subscriptionsPage = page.locator('.subscriptionsPage')
    await subscriptionsPage.evaluate(element => {
      element.dataset.settingsShortcutMarker = 'preserved'
    })

    await app.electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0]
      if (!browserWindow) throw new Error('Browser window was not found')
      browserWindow.webContents.send('change-view', {
        route: '/settings',
        tabId: 'preferences-test'
      })
    })

    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(subscriptionsPage).toHaveAttribute('data-settings-shortcut-marker', 'preserved')
  })

  test('keeps a direct legacy settings route inside the app', async ({ page }) => {
    const tab = await page.evaluate(() => window.ftElectron.tabs.create({
      route: '/settings',
      makeActive: true
    }))

    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.ftElectron.tabs.getState())
      return state.tabs.find(candidate => candidate.id === tab.id)?.route.fullPath
    }).toBe('/')
  })

  test('toggles from the app settings button', async ({ page }) => {
    const profileButton = page.locator('.profileTrigger')
    await profileButton.click()
    const settingsButton = page.locator('.allSettingsShortcut')
    await expect(settingsButton.locator('[data-icon="gear"]')).toBeVisible()
    await expect(page.locator('.sideNav').getByText('Settings', { exact: true })).toHaveCount(0)
    await settingsButton.click()
    await expect(page.locator('.settingsWindow')).toBeVisible()

    await profileButton.click()
    await expect(settingsButton).toBeVisible()
    await settingsButton.click()
    await expect(page.locator('.settingsWindow')).toHaveClass(/settings-window-leave-active/)
    await expect(page.locator('.settingsWindow')).toBeHidden()
  })

  test('minimizes utility windows into the header and restores their view', async ({ page }) => {
    for (const view of [null, 'about', 'downloads']) {
      await page.evaluate((windowView) => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return store.dispatch('showSettingsWindow', windowView)
      }, view)

      const windowName = view === 'about' ? 'About' : view === 'downloads' ? 'Downloads' : 'Settings'
      const settingsWindow = page.getByRole('dialog', { name: windowName, exact: true })
      await expect(settingsWindow).toBeVisible()
      await settingsWindow.getByRole('button', { name: /Minimi[sz]e/ }).click()

      await expect(settingsWindow).toBeHidden()
      const minimizedButton = page.locator('.minimizedUtilityButton')
      await expect(minimizedButton).toBeVisible()
      await expect(minimizedButton).toHaveAccessibleName(`Restore: ${windowName}`)
      if (view === 'downloads') {
        await expect(page.locator('.downloadsButton')).toHaveCount(0)
      }

      await minimizedButton.click()
      await expect(page.getByRole('dialog', { name: windowName, exact: true })).toBeVisible()
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.minimizedUtilityButton')).toHaveCount(0)
    }
  })

  test('preserves its scroll position after being minimized and restored', async ({ page }) => {
    await expectMinimizeToPreserveSettingsScroll(page)
  })

  test.describe('minimized at 95% UI scale', () => {
    test.use({ seed: { settings: { uiScale: 95 } } })

    test('preserves its scroll position when restored', async ({ page }) => {
      await expectMinimizeToPreserveSettingsScroll(page)
    })
  })

  test('restores the last selected category when reopened', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="privacy"]').click()
    await expect(page.locator('.settingsContent > [data-section="privacy"]')).toBeVisible()

    await page.locator('.settingsCloseButton').click()
    await goTo(page, 'settings')

    await expect(page.locator('.settingsContent > [data-section="privacy"]')).toBeVisible()
    await expect(page.locator('.settingsMenu [data-section="privacy"]')).toHaveClass(/active/)
  })

  test('focuses its search and closes with Escape', async ({ page }) => {
    await goTo(page, 'settings')
    const search = page.getByRole('searchbox', { name: 'Search settings' })
    await expect(search).toBeFocused()
    await search.evaluate(element => element.blur())
    await page.locator('.settingsSearch svg').click()
    await expect(search).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.locator('.settingsWindow')).toBeHidden()
  })

  test('searches setting labels and opens their category', async ({ page }) => {
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
    await search.fill('Custom External Player Executable')
    await page.getByRole('button', { name: 'Custom External Player Executable', exact: true }).click()
    const executableHighlight = page.locator('input.settingsSearchTarget')
    await expect(executableHighlight).toHaveAttribute('placeholder', 'Custom External Player Executable')
    expect(await executableHighlight.evaluate(element => getComputedStyle(element).animationName))
      .toContain('settings-search-highlight')
    expect((await executableHighlight.boundingBox()).height).toBeLessThanOrEqual(45)
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

  test('resizes without creating horizontal settings overflow', async ({ page }) => {
    await goTo(page, 'settings')
    const settingsWindow = page.locator('.settingsWindow')
    await expect(settingsWindow).not.toHaveClass(/settings-window-enter-active/)
    const originalBounds = await settingsWindow.boundingBox()
    const resizeHandle = page.locator('.resize-se')
    const handleBounds = await resizeHandle.boundingBox()

    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBounds.x - 600, handleBounds.y - 180)
    await page.mouse.up()

    const resizedBounds = await settingsWindow.boundingBox()
    expect(resizedBounds.width).toBeLessThan(originalBounds.width)
    expect(resizedBounds.height).toBeLessThan(originalBounds.height)
    expect(resizedBounds.x).toBeCloseTo(originalBounds.x, 0)
    expect(resizedBounds.y).toBeCloseTo(originalBounds.y, 0)
    await expect(settingsWindow.locator('.settingsPage')).toHaveClass(/compactSettings/)
    expect(await page.locator('.settingsContent').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return Array.from(element.querySelectorAll('*'))
        .filter(child => child.getBoundingClientRect().right > bounds.right + 1)
        .map(child => ({
          className: child.className?.toString(),
          right: child.getBoundingClientRect().right,
          tagName: child.tagName
        }))
    })).toEqual([])

    await expect.poll(() => page.evaluate(() => {
      return JSON.parse(localStorage.getItem('opentubex-settings-window-bounds'))?.width
    })).toBeCloseTo(resizedBounds.width, 0)
    await page.locator('.settingsCloseButton').click()
    await goTo(page, 'settings')
    await expect(settingsWindow).not.toHaveClass(/settings-window-enter-active/)

    const restoredBounds = await settingsWindow.boundingBox()
    expect(restoredBounds.width).toBeCloseTo(resizedBounds.width, 0)
    expect(restoredBounds.height).toBeCloseTo(resizedBounds.height, 0)
  })

  test('keeps stacked theme selects compact in a narrow settings window', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 400,
        height: 700
      }))
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const selects = page.locator('.settingsContent .themeSelectRow .select')
    await expect(selects.first()).toBeVisible()
    expect(await selects.evaluateAll(elements => elements.every(element => element.offsetHeight === 45))).toBe(true)
    expect(await selects.evaluateAll(elements => elements.every(element => {
      const buttonBounds = element.querySelector('.select-text').getBoundingClientRect()
      const arrowBounds = element.querySelector('.iconSelect').getBoundingClientRect()
      return Math.abs(
        arrowBounds.top + arrowBounds.height / 2 - (buttonBounds.top + buttonBounds.height / 2)
      ) <= 1
    }))).toBe(true)
  })

  test('clamps Theme settings after a narrow-to-wide reflow', async ({ page }) => {
    await page.setViewportSize({ width: 340, height: 600 })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const content = page.locator('.settingsContent')
    await content.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await page.setViewportSize({ width: 1200, height: 800 })
    await expect.poll(() => content.evaluate(element => {
      const section = Array.from(element.children).find(child => {
        return child.classList.contains('section') && getComputedStyle(child).display !== 'none'
      })
      const maximum = Math.max(0, section.offsetTop + section.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
      return element.scrollTop <= maximum + 1
    })).toBe(true)
  })

  test('does not clamp a subpixel Theme settings scroll boundary', async ({ page }) => {
    await goToSettingsSection(page, 'appearance')

    const result = await page.locator('.settingsContent').evaluate(element => {
      element.scrollTop = element.scrollHeight

      let prototype = Object.getPrototypeOf(element)
      let descriptor = null
      while (prototype !== null && descriptor === null) {
        descriptor = Object.getOwnPropertyDescriptor(prototype, 'scrollTop') ?? null
        prototype = Object.getPrototypeOf(prototype)
      }
      if (descriptor?.get === undefined || descriptor.set === undefined) {
        throw new Error('Unable to inspect the native scrollTop property')
      }

      const section = element.querySelector(':scope > .section')
      const maximum = Math.max(0, section.offsetTop + section.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
      const writes = []

      Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        get() {
          // Electron zoom can put the real boundary between CSS pixels even
          // though the layout properties used above report integer values.
          return descriptor.get.call(this) + 0.25
        },
        set(value) {
          writes.push(value)
          descriptor.set.call(this, value)
        }
      })

      try {
        const observedScrollTop = element.scrollTop
        element.dispatchEvent(new Event('scroll'))
        return { maximum, observedScrollTop, writes }
      } finally {
        delete element.scrollTop
      }
    })

    expect(result.observedScrollTop).toBeGreaterThan(result.maximum)
    expect(result.observedScrollTop).toBeLessThanOrEqual(result.maximum + 1)
    expect(result.writes).toEqual([])
  })

  test('opens Downloads from the download settings category', async ({ page }) => {
    const routeBeforeOpening = page.url()
    const downloadSection = await goToSettingsSection(page, 'download')

    await downloadSection.getByRole('button', { name: 'Open Downloads' }).click()
    await expect(page.getByRole('dialog', { name: 'Downloads', exact: true })).toBeVisible()
    await expect(page.locator('.settingsWindow')).toHaveCount(1)
    expect(page.url()).toBe(routeBeforeOpening)
  })

  test('moves Downloads and Settings from Quick Settings into the app header', async ({ page }) => {
    const themeSection = await goToSettingsSection(page, 'appearance')
    const downloadsToggle = themeSection.getByRole('checkbox', {
      name: 'Move Downloads to App Header'
    })
    const settingsToggle = themeSection.getByRole('checkbox', {
      name: 'Move Settings to App Header'
    })

    await expect(downloadsToggle).not.toBeChecked()
    await expect(settingsToggle).not.toBeChecked()
    await expect(page.locator('.topNav .downloadsButton')).toHaveCount(0)
    await expect(page.locator('.topNav .settingsButton')).toHaveCount(0)

    await page.locator('.profileTrigger').click()
    const menu = page.getByRole('dialog', { name: 'Quick settings' })
    const downloadsShortcut = menu.getByRole('button', { name: 'Downloads' })
    const allSettingsShortcut = menu.getByRole('button', { name: 'All settings' })
    await expect(downloadsShortcut).toBeVisible()
    await expect(allSettingsShortcut).toBeVisible()
    await expect(menu.getByRole('heading', { name: 'Playback', exact: true })).toBeVisible()
    await expect(menu.getByRole('heading', { name: 'Language and region', exact: true })).toBeVisible()
    await page.locator('.profileTrigger').click()

    await themeSection.locator('label.switch-label')
      .filter({ hasText: 'Move Downloads to App Header' }).click()
    await themeSection.locator('label.switch-label')
      .filter({ hasText: 'Move Settings to App Header' }).click()
    await expect(downloadsToggle).toBeChecked()
    await expect(settingsToggle).toBeChecked()
    await page.locator('.settingsCloseButton').click()

    const downloadsButton = page.locator('.topNav .downloadsButton')
    const settingsButton = page.locator('.topNav .settingsButton')
    await expect(downloadsButton).toBeVisible()
    await expect(settingsButton).toBeVisible()

    await page.locator('.profileTrigger').click()
    await expect(downloadsShortcut).toHaveCount(0)
    await expect(allSettingsShortcut).toHaveCount(0)
    await page.locator('.profileTrigger').click()

    for (const [button, windowName] of [
      [downloadsButton, 'Downloads'],
      [settingsButton, 'Settings']
    ]) {
      await button.click()
      const utilityWindow = page.getByRole('dialog', { name: windowName, exact: true })
      await expect(utilityWindow).toBeVisible()
      await expect(utilityWindow.getByRole('button', { name: /Minimi[sz]e/ })).toHaveCount(0)
      await utilityWindow.getByRole('button', { name: 'Close' }).click()
    }
  })

  test('clamps the Downloads scroll position when a wider layout becomes shorter', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 400,
        height: 650
      }))
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (let index = 0; index < 8; index++) {
        store.commit('upsertYtDlpDownload', {
          id: index + 1,
          title: `Responsive download ${index + 1}`,
          status: 'completed',
          mode: 'video',
          availability: 'available',
          destination: `/tmp/responsive-download-${index + 1}.webm`,
          sizeBytes: 1024 * (index + 1)
        })
      }
    })
    await goTo(page, 'downloads')
    const downloadsScroll = page.locator('.settingsDownloadsPage')
    await downloadsScroll.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => downloadsScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    const resizeHandle = page.locator('.resize-e')
    const handleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBounds.x + 600, handleBounds.y + handleBounds.height / 2)
    await page.mouse.up()

    await expect.poll(() => downloadsScroll.evaluate(element => {
      const content = element.firstElementChild
      const maximumScrollTop = Math.max(0, content.offsetTop + content.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom) - element.clientHeight)
      return element.scrollTop <= maximumScrollTop + 1
    })).toBe(true)
  })

  test('resets standalone scroll position when switching views', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 400,
        height: 650
      }))
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      for (let index = 0; index < 8; index++) {
        store.commit('upsertYtDlpDownload', {
          id: index + 1,
          title: `View switch download ${index + 1}`,
          status: 'completed',
          mode: 'video',
          availability: 'available',
          destination: `/tmp/view-switch-download-${index + 1}.webm`
        })
      }
    })
    await goTo(page, 'downloads')
    const downloadsScroll = page.locator('.settingsDownloadsPage')
    await downloadsScroll.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => downloadsScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('showSettingsWindow', 'about')
    })
    await expect(page.getByRole('dialog', { name: 'About', exact: true })).toBeVisible()
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('showSettingsWindow', 'downloads')
    })

    await expect.poll(() => page.locator('.settingsDownloadsPage').evaluate(element => element.scrollTop)).toBe(0)
  })

  test('clamps the settings scroll position after repeated resizing', async ({ page }) => {
    await goTo(page, 'settings')
    const settingsWindow = page.locator('.settingsWindow')
    const content = page.locator('.settingsContent')
    const resizeHandle = page.locator('.resize-se')
    await expect(settingsWindow).not.toHaveClass(/settings-window-enter-active/)

    const originalHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      originalHandleBounds.x + originalHandleBounds.width / 2,
      originalHandleBounds.y + originalHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(originalHandleBounds.x - 180, originalHandleBounds.y - 180)
    await page.mouse.up()

    await content.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    const smallerHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      smallerHandleBounds.x + smallerHandleBounds.width / 2,
      smallerHandleBounds.y + smallerHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(smallerHandleBounds.x + 180, smallerHandleBounds.y + 180)
    await page.mouse.up()

    await page.waitForTimeout(250)
    expect(await content.evaluate(element => {
      const section = element.querySelector('.section')
      const contentEnd = section.offsetTop + section.offsetHeight +
        Number.parseFloat(getComputedStyle(element).paddingBottom)
      return element.scrollTop - Math.max(0, contentEnd - element.clientHeight)
    })).toBeLessThanOrEqual(1)

    const restoredHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      restoredHandleBounds.x + restoredHandleBounds.width / 2,
      restoredHandleBounds.y + restoredHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(restoredHandleBounds.x - 180, restoredHandleBounds.y - 180)
    await page.mouse.up()

    const menu = page.locator('.settingsMenu')
    await menu.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    const compactHandleBounds = await resizeHandle.boundingBox()
    await page.mouse.move(
      compactHandleBounds.x + compactHandleBounds.width / 2,
      compactHandleBounds.y + compactHandleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(compactHandleBounds.x + 180, compactHandleBounds.y + 180)
    await page.mouse.up()

    await page.waitForTimeout(250)
    expect(await menu.evaluate(element => (
      element.scrollTop - Math.max(0, element.scrollHeight - element.clientHeight)
    ))).toBeLessThanOrEqual(1)
  })

  test('animates maximize and restore while preserving its floating bounds', async ({ page }) => {
    await goTo(page, 'settings')
    const settingsWindow = page.locator('.settingsWindow')
    await expect(settingsWindow).not.toHaveClass(/settings-window-enter-active/)
    const originalBounds = await settingsWindow.boundingBox()
    await settingsWindow.evaluate(element => {
      const animate = element.animate.bind(element)
      element.animate = (...args) => {
        element.dataset.boundsAnimationStarted = 'true'
        return animate(...args)
      }
    })

    await page.getByRole('button', { name: 'Maximize' }).click()
    await expect(settingsWindow).toHaveClass(/maximized/)
    await expect(settingsWindow).toHaveAttribute('data-bounds-animation-started', 'true')
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await expect.poll(async () => (await settingsWindow.boundingBox()).width).toBe(viewport.width)
    await expect.poll(async () => (await settingsWindow.boundingBox()).height).toBe(viewport.height)
    await expect(page.locator('.settingsResizeHandle:visible')).toHaveCount(0)

    await settingsWindow.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(settingsWindow).not.toHaveClass(/maximized/)
    await expect.poll(async () => (await settingsWindow.boundingBox()).width)
      .toBeCloseTo(originalBounds.width, 0)
    await expect.poll(async () => (await settingsWindow.boundingBox()).height)
      .toBeCloseTo(originalBounds.height, 0)

    const breadcrumb = page.locator('.settingsBreadcrumb')
    const breadcrumbBounds = await breadcrumb.boundingBox()
    await breadcrumb.dblclick({
      position: { x: breadcrumbBounds.width - 4, y: breadcrumbBounds.height / 2 }
    })
    await expect(settingsWindow).toHaveClass(/maximized/)
    await breadcrumb.dblclick({
      position: { x: breadcrumbBounds.width - 4, y: breadcrumbBounds.height / 2 }
    })
    await expect(settingsWindow).not.toHaveClass(/maximized/)

    await page.getByRole('button', { name: 'Maximize' }).click()
    await expect(settingsWindow).toHaveClass(/maximized/)
    await expect(page.locator('body > .os-scrollbar-vertical')).toHaveCSS('visibility', 'hidden')
    await expect.poll(() => settingsWindow.evaluate(element => element.getAnimations().length)).toBe(0)
    const dragTargetBounds = await page.locator('.settingsBreadcrumbLabel').first().boundingBox()
    await page.mouse.move(
      dragTargetBounds.x + dragTargetBounds.width / 2,
      dragTargetBounds.y + dragTargetBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      dragTargetBounds.x + dragTargetBounds.width / 2 + 30,
      dragTargetBounds.y + dragTargetBounds.height / 2 + 20
    )
    await expect(settingsWindow).not.toHaveClass(/maximized/)
    await page.mouse.up()
    await expect.poll(async () => (await settingsWindow.boundingBox()).width)
      .toBeCloseTo(originalBounds.width, 0)
  })

  test('keeps the settings window inside the narrowest supported viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await goTo(page, 'settings')
    await page.setViewportSize({ width: 340, height: 600 })
    await expect(page.locator('.settingsWindow')).not.toHaveClass(/settings-window-enter-active/)

    const bounds = await page.locator('.settingsWindow').boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(340)
  })

  test('keeps its minimum size when a resize pointer crosses the window', async ({ page }) => {
    await goTo(page, 'settings')
    const resizeHandle = page.locator('.resize-se')
    const handleBounds = await resizeHandle.boundingBox()

    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(0, 0)
    await page.mouse.up()

    // Rounded because the window lands on a fractional CSS pixel on scaled
    // displays: the point is that it stopped at its 360px minimum instead of
    // collapsing, not that it hit it to the pixel.
    const bounds = await page.locator('.settingsWindow').boundingBox()
    expect(Math.round(bounds.width)).toBeGreaterThanOrEqual(360)
    expect(Math.round(bounds.height)).toBeGreaterThanOrEqual(360)
  })

  test('wraps controls before the two-column detail pane clips them', async ({ page, attachScreenshot }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 820,
        height: 700
      }))
    })
    await goTo(page, 'settings')
    await expect(page.locator('.settingsPage')).not.toHaveClass(/compactSettings/)

    for (const grid of ['.switchColumnGrid', '.switchGrid']) {
      expect(await page.locator(grid).first().evaluate(element => {
        return getComputedStyle(element).gridTemplateColumns.split(' ').length
      })).toBe(1)
    }

    const content = page.locator('.settingsContent')
    expect(await content.evaluate(element => {
      const rightEdge = element.getBoundingClientRect().right
      return Array.from(element.querySelectorAll('.section *')).every(child => {
        const bounds = child.getBoundingClientRect()
        return bounds.width === 0 || bounds.right <= rightEdge + 1
      })
    })).toBe(true)
    await attachScreenshot('820px wide settings window')
  })

  test('returns from saved channel settings through its clickable breadcrumb', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await page.getByRole('button', { name: /Manage Saved Channels/ }).click()

    const breadcrumb = page.locator('.settingsBreadcrumb')
    await expect(breadcrumb).toContainText('Settings')
    await expect(breadcrumb).toContainText('Playback')
    await expect(breadcrumb).toContainText('Saved Channel Settings')
    await expect(breadcrumb.locator('.settingsBreadcrumbSubpageIcon[data-icon="users"]')).toBeVisible()
    await breadcrumb
      .getByRole('button', { name: 'Playback' })
      .locator('.settingsBreadcrumbCategoryIcon')
      .click()

    await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()
    await expect(breadcrumb).not.toContainText('Saved Channel Settings')
  })

  test('keeps saved-channel controls in two columns without narrow wrapping', async ({ page, attachScreenshot }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return Promise.all([
        store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify({
          channel1: 1,
          channel2: 1.25,
          channel3: 1.5
        })),
        store.dispatch('updateChannelVideoQualities', JSON.stringify({ channel1: '1080' })),
        store.dispatch('updateChannelSubtitlesStates', JSON.stringify({ channel1: true })),
        store.dispatch('updateChannelVolumes', JSON.stringify({ channel1: 0.5 }))
      ])
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await page.getByRole('button', { name: /Manage Saved Channels/ }).click()

    const entries = page.locator('.channelEntry')
    await expect(entries).toHaveCount(3)
    const firstEntryPreferences = entries.first().locator('.channelPreference')
    const preferenceTops = await firstEntryPreferences.evaluateAll(elements => {
      return elements.slice(0, 2).map(element => Math.round(element.getBoundingClientRect().top))
    })
    expect(new Set(preferenceTops).size).toBe(1)
    await attachScreenshot('saved channel controls in two columns')

    await entries.first().locator('.channelLink').click()
    await expect(page.locator('.settingsBreadcrumb')).toContainText('Saved Channel Settings')
    await expect(page.locator('.channelListContainer')).toBeVisible()
  })

  test('keeps shortcut and saved-channel subpages scrollable in compact layout', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 500,
        height: 450
      }))
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return Promise.all([
        store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify(Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [`channel${index}`, 1 + index / 10])
        ))),
        store.dispatch('updateChannelVideoQualities', JSON.stringify({ channel0: '1080' })),
        store.dispatch('updateChannelSubtitlesStates', JSON.stringify({ channel0: true })),
        store.dispatch('updateChannelVolumes', JSON.stringify({ channel0: 0.5 }))
      ])
    })
    await goTo(page, 'settings')
    await expect(page.locator('.settingsPage')).toHaveClass(/compactSettings/)
    const [headerBounds, searchBounds] = await Promise.all([
      page.locator('.settingsWindowHeader').boundingBox(),
      page.locator('.settingsSearch').boundingBox()
    ])
    expect(searchBounds.x - headerBounds.x).toBeCloseTo(10, 0)
    expect(headerBounds.x + headerBounds.width - searchBounds.x - searchBounds.width)
      .toBeCloseTo(10, 0)
    await page.getByRole('searchbox', { name: 'Search settings' }).fill('FFmpeg Source')
    await expect(page.locator('.settingsMenu')).toBeHidden()
    await expect(page.getByRole('button', { name: 'FFmpeg Source', exact: true })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Search settings' }).fill('')
    await expect(page.locator('.settingsMenu')).toBeVisible()
    await recordAnimations(page)
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await expectAnimation(page, 'settings-compact-slide-forward')
    await page.getByRole('button', { name: /Manage Saved Channels/ }).click()

    const channelList = page.locator('.channelListContainer')
    expect(await page.locator('.channelPreferences').first().evaluate(element => {
      return getComputedStyle(element).gridTemplateColumns.split(' ').length
    })).toBe(1)
    expect(await channelList.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await channelList.evaluate(element => {
      element.scrollTop = element.scrollHeight
    })
    await expect.poll(() => channelList.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await recordAnimations(page)
    await page.locator('.settingsBreadcrumbRoot .settingsWindowIcon').click()
    await expect(page.locator('.settingsMenu')).toBeVisible()
    await expectAnimation(page, 'settings-compact-slide-backward')

    await page.getByRole('button', { name: 'Show Keyboard Shortcuts' }).click()
    const shortcuts = page.locator('.shortcutColumns')
    expect(await shortcuts.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await shortcuts.evaluate(element => {
      element.scrollTop = element.scrollHeight
    })
    await expect.poll(() => shortcuts.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await page.locator('.settingsBreadcrumbRoot .settingsWindowIcon').click()
    await expect(page.locator('.settingsMenu')).toBeVisible()
    await expect(page.locator('.settingsContent')).toBeHidden()
  })

  test('animates category changes vertically in two-column layout', async ({ page }) => {
    await goTo(page, 'settings')

    await recordAnimations(page)
    await page.locator('.settingsMenu [data-section="playback"]').click()
    await expectAnimation(page, 'settings-section-slide-forward')
    await page.locator('.settingsMenu [data-section="appearance"]').click()
    await expectAnimation(page, 'settings-section-slide-backward')

    // The class is cleared once it has played, so nothing replays the slide
    // later on — rebuilding the overlay scrollbars used to.
    await expect(page.locator('.settingsContent')).not.toHaveClass(/settingsSectionSlide/)
    await recordAnimations(page)
    await page.locator('label.switch-label').filter({ hasText: 'Always Show Scrollbars' }).click()
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => window.__playedAnimations)).toEqual([])
  })

  test('keeps its scroll position when always-visible scrollbars are enabled', async ({ page }) => {
    await expectAlwaysVisibleScrollbarsToPreserveSettingsScroll(page)
  })

  test.describe('with 95% UI scale', () => {
    test.use({ seed: { settings: { uiScale: 95 } } })

    test('keeps its scroll position when always-visible scrollbars are enabled', async ({ page }) => {
      await expectAlwaysVisibleScrollbarsToPreserveSettingsScroll(page)
    })
  })

  test.describe('with reduced motion', () => {
    test.use({ seed: { settings: { reducedMotion: 'on' } } })

    test('leaves no slide class behind for a suppressed animation', async ({ page }) => {
      await goTo(page, 'settings')
      await recordAnimations(page)
      await page.locator('.settingsMenu [data-section="playback"]').click()
      await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()

      // Nothing plays, and nothing is left that could play later: turning
      // reduced motion back off would otherwise slide the settings unprompted.
      await expect(page.locator('.settingsContent')).not.toHaveClass(/settingsSectionSlide/)
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return store.dispatch('updateReducedMotion', 'off')
      })
      await page.waitForTimeout(500)
      expect(await page.evaluate(() => window.__playedAnimations)).toEqual([])
    })
  })

  test('keeps quick playback speed actions sticky and reflects the default state', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()
    const customizeButton = page.getByRole('button', {
      name: 'Customize Quick Playback Speed Bar'
    })
    await expect(customizeButton).toBeDisabled()
    await page.locator('label.switch-label')
      .filter({ hasText: 'Use Quick Playback Speed Bar' })
      .click()
    await expect(customizeButton).toBeEnabled()
    await customizeButton.click()

    await expect(page.locator('.settingsBreadcrumb [data-icon="gauge-high"]')).toBeVisible()

    const scroller = page.locator('.settingsSubpageScroll')
    const toolbar = page.locator('.quickPlaybackSpeedToolbar')
    const list = page.locator('.quickPlaybackSpeedList')
    const reset = page.getByRole('button', { name: 'Reset to Defaults' })
    await expect(reset).toBeDisabled()

    const [scrollerBounds, scrollerClientWidth, listBounds] = await Promise.all([
      scroller.boundingBox(),
      scroller.evaluate(element => element.clientWidth),
      list.boundingBox()
    ])
    expect(listBounds.width).toBeLessThanOrEqual(800)
    expect(Math.abs(
      listBounds.x + listBounds.width / 2 - scrollerBounds.x - scrollerClientWidth / 2
    )).toBeLessThanOrEqual(1)

    await page.getByRole('button', { name: 'Add Playback Speed' }).click()
    await expect(reset).toBeEnabled()
    await reset.click()
    await expect(reset).toBeDisabled()

    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(async () => {
      const [currentScrollerBounds, toolbarBounds] = await Promise.all([
        scroller.boundingBox(),
        toolbar.boundingBox()
      ])
      return Math.abs(toolbarBounds.y - currentScrollerBounds.y)
    }).toBeLessThanOrEqual(1)
    await expect(toolbar).toBeVisible()
  })

  test('aligns caption color controls with neighboring selects', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()

    const edgeStyle = page.getByRole('combobox', { name: 'Edge Style' })
    await edgeStyle.click()
    await page.getByRole('option', { name: 'Drop Shadow' }).click()

    const edgeStyleControl = edgeStyle.locator('..').locator('..')
    const edgeColorControl = page.locator('.captionColorControl').filter({ hasText: 'Edge Color' })
    const edgeColorTrigger = edgeColorControl.getByRole('button', { name: 'Edge Color' })
    const [styleControlBounds, colorControlBounds, colorTriggerBounds] = await Promise.all([
      edgeStyleControl.boundingBox(),
      edgeColorControl.boundingBox(),
      edgeColorTrigger.boundingBox()
    ])

    expect(colorControlBounds.y).toBeCloseTo(styleControlBounds.y, 0)
    expect(colorControlBounds.height).toBeCloseTo(styleControlBounds.height, 0)
    expect(colorTriggerBounds.y).toBeCloseTo(colorControlBounds.y, 0)
    expect(colorTriggerBounds.height).toBeCloseTo(colorControlBounds.height, 0)
  })

  test('stacks caption controls at narrow settings widths', async ({ page, attachScreenshot }) => {
    await page.evaluate(() => {
      localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({
        x: 40,
        y: 40,
        width: 420,
        height: 700
      }))
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()

    const preview = page.locator('.captionPreview')
    const initialPreviewBounds = await preview.boundingBox()
    await page.getByRole('slider', { name: /Font Size/ }).fill('400')
    const enlargedPreviewBounds = await preview.boundingBox()
    expect(initialPreviewBounds.height).toBe(240)
    expect(enlargedPreviewBounds.height).toBe(initialPreviewBounds.height)

    const controls = page.locator('.captionControls')
    expect(await controls.evaluate(element => {
      return getComputedStyle(element).gridTemplateColumns.split(' ').length
    })).toBe(1)
    await attachScreenshot('caption settings at 420px')

    const contentBounds = await page.locator('.settingsContent').boundingBox()
    expect(await page.locator('.captionControl').evaluateAll((elements, rightEdge) => {
      return elements.every(element => element.getBoundingClientRect().right <= rightEdge + 1)
    }, contentBounds.x + contentBounds.width)).toBe(true)
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
    expect(fontFamily).toContain('Roboto')
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
      element.style.left = `${element.getBoundingClientRect().left + offset}px`
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
    expect(appearance.cursor).toBe('default')
    expect(appearance.menuTop).toBeGreaterThanOrEqual(appearance.chromeBottom)

    const scrollbarHandle = dropdown.locator('.os-scrollbar-vertical .os-scrollbar-handle')
    const handleBounds = await scrollbarHandle.boundingBox()
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2 + 30
    )
    await expect(dropdown).toBeVisible()
    await page.mouse.up()

    await combobox.press('Home')
    await combobox.press('ArrowDown')
    await combobox.press('Enter')
    await expect(combobox).toContainText('English (US) (100%)')
    await expect(dropdown).toHaveCount(0)

    await page.locator('.settingsMenu [data-section="advanced"]').click()
    await page.getByRole('combobox', { name: 'Preferred API backend' }).click()
    await expect(dropdown).toBeVisible()
    expect(await dropdown.evaluate(menu => menu.scrollHeight <= menu.clientHeight)).toBe(true)
  })

  test('contains wheel scrolling at the ends of select dropdowns', async ({ page }) => {
    await goTo(page, 'settings')

    await page.evaluate(() => {
      document.body.style.minBlockSize = '4000px'
      document.scrollingElement.scrollTop = 1000
    })
    await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop))
      .toBe(1000)

    await page.getByRole('combobox', { name: /Language preference|Locale Preference/ }).click()
    const dropdown = page.locator('.selectDropdown')
    await expect(dropdown).toBeVisible()
    await dropdown.hover()

    for (const { dropdownEnd, wheelDelta } of [
      { dropdownEnd: 'bottom', wheelDelta: 1000 },
      { dropdownEnd: 'top', wheelDelta: -1000 }
    ]) {
      await dropdown.evaluate((element, end) => {
        element.scrollTop = end === 'bottom' ? element.scrollHeight : 0
      }, dropdownEnd)
      const pageScrollTop = await page.evaluate(() => document.scrollingElement.scrollTop)

      for (let index = 0; index < 5; index++) {
        await page.mouse.wheel(0, wheelDelta)
      }

      await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop))
        .toBe(pageScrollTop)
    }
  })

  test('closes without replacing the underlying page', async ({ page }) => {
    const url = page.url()
    await goTo(page, 'settings')
    await page.locator('.settingsCloseButton').click()

    await expect(page.locator('.settingsWindow')).toHaveCount(0)
    await expect(page).toHaveURL(url)
  })

  test('switches sections without changing the current URL', async ({ page }) => {
    const url = page.url()
    await goTo(page, 'settings')

    const playerSectionLink = page.locator('.settingsMenu [data-section="playback"]')
    await playerSectionLink.click()
    await expect(playerSectionLink).toHaveClass(/active/)
    await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()
    await expect(page).toHaveURL(url)
  })

  test('scrolls to the top when switching categories', async ({ page }) => {
    await goToSettingsSection(page, 'appearance')
    const content = page.locator('.settingsContent')
    await content.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await page.locator('.settingsMenu [data-section="privacy"]').click()
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0)
  })

  test('keeps the window and its scroll position when switching tabs', async ({ page }) => {
    await goTo(page, 'settings')

    const playerSectionLink = page.locator('.settingsMenu [data-section="playback"]')
    await playerSectionLink.click()

    const settingsContent = page.locator('.settingsContent')
    const sectionScrollPosition = await settingsContent.evaluate(element => element.scrollTop)
    await settingsContent.hover()
    await page.mouse.wheel(0, 200)
    await expect.poll(() => settingsContent.evaluate(element => element.scrollTop))
      .toBeGreaterThan(sectionScrollPosition)
    const scrollPosition = await settingsContent.evaluate(element => element.scrollTop)
    await expect(playerSectionLink).toHaveClass(/active/)

    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await page.locator(sel.tabs).first().click()
    await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
    await expect(page.locator('.settingsWindow')).toBeVisible()
    await expect(playerSectionLink).toHaveClass(/active/)

    await expect.poll(() => settingsContent.evaluate(element => element.scrollTop)).toBe(scrollPosition)
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

  test('enables YouTube-style Shorts by default in player settings', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="playback"]').click()

    const toggle = page.getByRole('checkbox', { name: 'Use YouTube-style Shorts' })
    await expect(toggle).toBeChecked()

    await page.locator('label.switch-label')
      .filter({ hasText: 'Use YouTube-style Shorts' })
      .click()
    await expect(toggle).not.toBeChecked()
  })

  test('shows voice-over settings disabled until translation is enabled', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="add-ons"]').click()

    const settingsContent = page.locator('.settingsContent')
    const voiceOverSection = page.locator('.settingsSection').filter({
      has: page.getByRole('heading', { name: /Voice-over translation/ })
    })
    await settingsContent.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(voiceOverSection).toBeInViewport()

    const enableToggle = page.getByRole('checkbox', { name: 'Enable voice-over translation' })
    const backgroundToggle = page.getByRole('checkbox', {
      name: 'Start preparing voice-over translations in the background'
    })
    const languageSelect = page.getByRole('combobox', {
      name: 'Voice-over translation language'
    })

    await expect(enableToggle).not.toBeChecked()
    await expect(backgroundToggle).toBeDisabled()
    await expect(languageSelect).toBeDisabled()
    await page.locator('label.switch-label')
      .filter({ hasText: 'Enable voice-over translation' })
      .click()

    await expect(backgroundToggle).toBeEnabled()
    await expect(backgroundToggle).not.toBeChecked()
    await expect(languageSelect).toBeEnabled()
    await expect(page.getByRole('checkbox', {
      name: 'Cache voice-over translations for one day'
    })).toHaveCount(0)
    await expect(page.getByText('Supported source languages: Russian, English, Chinese, Korean,'))
      .toBeVisible()
  })

  test('the tab width slider only becomes usable with fixed tab width on', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const slider = page.getByRole('slider', { name: /Tab Width/ })
    const fixedWidthToggle = page.locator('.switchColumnGrid > .switchColumn').first()
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

  test('configures animation speed and disables it with reduced motion', async ({ page }) => {
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="appearance"]').click()

    const slider = page.getByRole('slider', { name: /Animation Speed/ })
    await expect(slider).toHaveValue('100')
    await expect(slider).toBeEnabled()

    await slider.fill('200')
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('updateReducedMotion', 'on')
    })
    await expect(slider).toBeDisabled()

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.dispatch('updateReducedMotion', 'off')
    })
    await expect(slider).toBeEnabled()
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
    await page.locator('.settingsMenu [data-section="sync"]').click()

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
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await expect(syncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect(syncSection.getByLabel('Server URL')).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(syncRequests).toEqual([])
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
    await attachScreenshot('material icon pack')
    await select.selectOption('remix')
    await expect(page.locator('[data-icon-pack="remix"]').first()).toBeVisible()
    await expect(page.locator(
      '.settingsMenu [data-section="add-ons"] [data-icon="puzzle-piece"][data-icon-pack="remix"]'
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
    await expect(layout.locator('.themeSelectRow .select')).toHaveCount(1)

    const baseThemeLabel = selectRows.first().locator('.select').first().locator('.select-label')
    const alignedLabelParts = await baseThemeLabel
      .locator('.select-icon, .select-placeholder, .syncedSettingIndicator, .changedSettingIndicatorPlaceholder')
      .evaluateAll(elements => elements.map(element => {
        const bounds = element.getBoundingClientRect()
        return bounds.y + bounds.height / 2
      }))
    expect(Math.max(...alignedLabelParts) - Math.min(...alignedLabelParts)).toBeLessThanOrEqual(1)

    const switchPositions = await Promise.all([
      'Expand Side Bar by Default',
      'Disable Smooth Scrolling',
      'Always Show Scrollbars'
    ].map(label => page.getByRole('checkbox', { name: label }).boundingBox()))
    const switchX = switchPositions.map(position => position.x)
    expect(Math.max(...switchX) - Math.min(...switchX)).toBeLessThanOrEqual(1)
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
    // Give nedb a moment to flush the write.
    await page.waitForTimeout(1000)

    ;({ page } = await app.relaunch())
    await goTo(page, 'settings')
    await expect(page.getByRole('checkbox', { name: 'Check for Updates' })).toBeChecked()
  })

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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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

    await expect(toggle).toBeChecked()
    await appearance.locator('label.switch-label')
      .filter({ hasText: 'Show thumbnail previews' })
      .click()
    await expect(toggle).not.toBeChecked()
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
      await page.waitForTimeout(400)
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
    await page.waitForTimeout(400)

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
    await page.waitForTimeout(700)

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

    await page.waitForTimeout(1200)
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
    await page.waitForTimeout(700)

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

    const centres = await page.locator('.toast').evaluateAll((elements) => {
      return elements
        .map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect()
          return { x: x + width / 2, y: y + height / 2 }
        })
        .sort((a, b) => b.y - a.y)
    })

    // Walking from one toast to the next must never drop out of the stack, or
    // it collapses under the pointer and immediately reopens
    for (let index = 1; index < centres.length; index++) {
      const from = centres[index - 1]
      const to = centres[index]

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
    await page.mouse.move(widest + 120, centres[0].y)
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
    await page.waitForTimeout(500)

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
    await page.waitForTimeout(700)

    await page.locator('.toast', { hasText: 'Delta toast' }).hover()
    await expect(page.locator('[data-sonner-toast]').first()).toHaveAttribute('data-expanded', 'true')
    await page.waitForTimeout(400)

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
    await page.waitForTimeout(700)

    const rows = page.locator('[data-sonner-toast]')
    await page.locator('.toast', { hasText: 'Delta toast' }).hover()
    await expect(rows.first()).toHaveAttribute('data-expanded', 'true')
    await page.waitForTimeout(400)

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

test.describe('preferred caption language migration', () => {
  test.use({ seed: { settings: { preferredCaptionLocale: 'zh-TW' } } })

  test('persists the equivalent YouTube language code for existing users', async ({ app, page }) => {
    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return settings.preferredCaptionLocale
    }).toBe('zh-Hant')

    const playback = await goToSettingsSection(page, 'playback')
    await expect(playback.getByRole('combobox', { name: 'Preferred Caption Language' }))
      .toContainText('Chinese (Traditional)')
  })
})

test.describe('existing Japanese caption preference', () => {
  test.use({ seed: { settings: { preferredCaptionLocale: 'ja' } } })

  test('remains selected before player caption metadata is available', async ({ page }) => {
    const playback = await goToSettingsSection(page, 'playback')
    await expect(playback.getByRole('combobox', { name: 'Preferred Caption Language' }))
      .toContainText('Japanese')
  })
})

test.describe('managed external software update controls', () => {
  test.use({
    seed: {
      settings: {
        ytDlpSource: 'managed',
        externalSoftwareUpdateMode: 'ask'
      }
    }
  })

  test('offers automatic, ask, and manual update modes', async ({ app, page }) => {
    const section = await goToSettingsSection(page, 'advanced')
    const updateMode = section.locator('.select')
      .filter({ hasText: 'Managed Tool Updates' })
      .locator('select')

    await expect(updateMode).toHaveValue('ask')
    await expect(updateMode.locator('option')).toHaveText([
      'Update automatically',
      'Ask before updating',
      'Only update manually'
    ])
    await expect(section.locator('.select').filter({ hasText: 'Managed Tool Updates' }))
      .toContainText('Managed Tool Updates')

    await updateMode.selectOption('manual')
    await expect(updateMode).toHaveValue('manual')
    await expect.poll(async () => {
      return latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      ).externalSoftwareUpdateMode
    }).toBe('manual')
  })
})

test.describe('dark theme settings', () => {
  test.use({ seed: { settings: { baseTheme: 'dark' } } })

  test('shows the search field against the settings header', async ({ page }) => {
    await goTo(page, 'settings')

    await expect(page.locator('.settingsWindowHeader'))
      .toHaveCSS('background-color', 'rgb(18, 18, 18)')
    await expect(page.locator('.settingsSearch'))
      .toHaveCSS('background-color', 'rgb(31, 31, 31)')
  })
})

test.describe('playback engine default', () => {
  test('uses the built-in engine for new users', async ({ app }) => {
    await goTo(app.page, 'settings')
    await goToSettingsSection(app.page, 'advanced')
    await expect(
      app.page.locator('[data-section="advanced"] .select')
        .filter({ hasText: 'Stream extraction method' })
        .locator('select')
    ).toHaveValue('built-in')
  })
})

test.describe('saved playback engine', () => {
  test.use({ seed: { settings: { videoPlaybackEngine: 'yt-dlp' } } })

  test('preserves the existing user choice', async ({ app }) => {
    await goTo(app.page, 'settings')
    await goToSettingsSection(app.page, 'advanced')
    await expect(
      app.page.locator('[data-section="advanced"] .select')
        .filter({ hasText: 'Stream extraction method' })
        .locator('select')
    ).toHaveValue('yt-dlp')
  })
})

test.describe('live chat replay visibility migration', () => {
  test.use({ seed: { settings: { hideLiveChat: true } } })

  test('preserves the old live chat visibility choice for replays', async ({ app }) => {
    await expect.poll(async () => {
      const settings = latestSettings(
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      )
      return {
        liveChat: settings.hideLiveChat,
        replay: settings.hideLiveChatReplay
      }
    }).toEqual({ liveChat: true, replay: true })
  })
})

test.describe('Downloads placement migration', () => {
  test.use({ seed: { settings: { moveDownloadsToQuickSettings: false } } })

  test('preserves an existing app header placement choice', async ({ app }) => {
    await expect.poll(() => app.page.evaluate(async (findAction) => {
      const settings = Object.fromEntries(
        (await window.ftElectron.dbSettings(findAction)).map(({ _id, value }) => [_id, value])
      )
      return {
        legacyPlacement: settings.moveDownloadsToQuickSettings,
        headerPlacement: settings.moveDownloadsToAppHeader
      }
    }, DBActions.GENERAL.FIND)).toEqual({
      legacyPlacement: undefined,
      headerPlacement: true
    })

    await expect(app.page.locator('.topNav .downloadsButton')).toBeVisible()
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
    await page.locator('.settingsMenu [data-section="add-ons"]').click()

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
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    await expect(syncSection.locator('.error')).toHaveText('Sync failed')

    await expect(syncSection.getByLabel('Server URL')).toBeDisabled()
    await expect(syncSection.getByLabel('Username')).toBeDisabled()
    await syncSection.getByRole('button', { name: 'Disconnect' }).click()

    try {
      await serverCheckRequested
      // Scoped to the sync failure: the same element also carries unrelated
      // notices (e.g. the enhanced-privacy hint) once the server check lands.
      await expect(syncSection.locator('.error', { hasText: 'Sync failed' })).toHaveCount(0)
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
    await page.locator('.settingsMenu [data-section="sync"]').click()

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
    await page.locator('.settingsMenu [data-section="sync"]').click()
    await otherWindow.locator('.settingsMenu [data-section="sync"]').click()
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
    await page.locator('.settingsMenu [data-section="sync"]').click()
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
    await page.locator('.settingsMenu [data-section="sync"]').click()

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
    await page.locator('.settingsMenu [data-section="sync"]').click()

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
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
      ).iconPack
    }).toBe('material')
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
    await goTo(page, 'settings')
    await expect(syncedLabel.getByRole('button', { name: 'Sync this setting' })).toBeVisible()

    const toggle = page.getByRole('checkbox', { name: /Auto load next page/i })
    await page.locator('label').filter({ hasText: 'Auto load next page' })
      .getByRole('button', { name: 'Stop syncing this setting' })
      .click()
    await expect(toggle).toBeChecked()

    const localOnlyLabel = page.locator('label').filter({ hasText: 'Check for Updates' })
    await expect(localOnlyLabel.getByRole('button', { name: /syncing this setting/i })).toHaveCount(0)
  })

  test('spaces setting sync and help icons', async ({ page }) => {
    await goTo(page, 'settings')
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

    await select.locator('.selectTooltip button').focus()
    const tooltipText = page.locator('body > [role="tooltip"]:visible')
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

  test('spreads the theme sliders evenly over their rows', async ({ page }) => {
    await goTo(page, 'settings')
    const themeSection = await goToSettingsSection(page, 'appearance')
    const sliders = themeSection.locator('.sliderGrid > *')
    await expect(sliders).toHaveCount(5)

    const boxes = await sliders.evaluateAll((elements) => elements.map((element) => {
      const { y, width } = element.getBoundingClientRect()
      return { y: Math.round(y), width: Math.round(width) }
    }))

    // Three and two, rather than four squeezed together and a lone fifth.
    const rowSizes = new Map()
    for (const { y } of boxes) {
      rowSizes.set(y, (rowSizes.get(y) ?? 0) + 1)
    }
    expect([...rowSizes.values()]).toEqual([3, 2])
    // The row they landed on doesn't change how much room they get.
    expect(new Set(boxes.map(({ width }) => width)).size).toBe(1)
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
    const [selectBox, selectLabelBox] = await Promise.all([
      viewingModeSelect.locator('.select-text').boundingBox(),
      viewingModeSelect.locator('.select-label').boundingBox()
    ])
    expect(selectBox).not.toBeNull()
    expect(selectLabelBox).not.toBeNull()
    expect(selectLabelBox.x).toBeCloseTo(selectBox.x, 0)
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
    const [tooltipBox, indicatorsBox] = await Promise.all([
      tooltipText.boundingBox(),
      neighboringIndicators.boundingBox()
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
        await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')
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
