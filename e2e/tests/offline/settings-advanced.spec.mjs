import { DBActions } from '../../../src/constants.js'
import { chooseSelectOption, test, expect, goToSettingsSection, latestSettings, readDatastore } from '../../helpers/app.mjs'

async function expectExternalSoftwarePathAlignment(tool, sourceName, pathLabel) {
  const source = tool.locator('.select').filter({ hasText: sourceName })
  const [sourceBox, helpBox, pathBox] = await Promise.all([
    source.locator('.select-text').boundingBox(),
    source.locator('.selectIndicators button').boundingBox(),
    tool.getByLabel(pathLabel).boundingBox()
  ])

  expect(sourceBox).not.toBeNull()
  expect(helpBox).not.toBeNull()
  expect(pathBox).not.toBeNull()
  expect(pathBox.x).toBeCloseTo(sourceBox.x, 0)
  expect(pathBox.width).toBeCloseTo(sourceBox.width, 0)
  const inputHelpBox = await tool.getByLabel(pathLabel).locator('..').locator('.inputIndicators button').first().boundingBox()
  expect(inputHelpBox.x).toBeCloseTo(helpBox.x, 0)
}

test.describe('settings', () => {
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
    await expect(ytDlpTool.getByLabel('yt-dlp executable')).toBeVisible()
    await expect(ffmpegTool.getByRole('combobox', { name: 'FFmpeg Source' })).toBeVisible()
    await expect(ffmpegTool.getByLabel('FFmpeg executable')).toBeVisible()
    await expect(ffmpegTool.locator('.externalSoftwareToolStatus')).toHaveText(
      'Detected FFmpeg/FFprobe version: 8.0'
    )

    const ytDlpSource = ytDlpTool.locator('.select').filter({ hasText: 'yt-dlp Source' })
    const ffmpegSource = ffmpegTool.locator('.select').filter({ hasText: 'FFmpeg Source' })
    await expect(ytDlpSource.locator('.select-icon')).toHaveCount(0)
    await expect(ffmpegSource.locator('.select-icon')).toHaveCount(0)
    await expectExternalSoftwarePathAlignment(
      ytDlpTool,
      'yt-dlp Source',
      'yt-dlp executable'
    )
    await expectExternalSoftwarePathAlignment(
      ffmpegTool,
      'FFmpeg Source',
      'FFmpeg executable'
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

    await chooseSelectOption(ytDlpSource.locator('select'), 'managed')
    await expect(ytDlpTool.getByRole('combobox', { name: 'yt-dlp Channel' })).toBeVisible()
    await expect(ytDlpTool.getByLabel('yt-dlp executable')).toHaveCount(0)
    await expect(ytDlpTool.getByRole('button', { name: 'Update yt-dlp' })).toBeVisible()
    await expect(ffmpegTool.getByLabel('FFmpeg executable')).toBeVisible()

    const positionsAfter = await Promise.all([
      positionWithinTool(ytDlpSource),
      positionWithinTool(ffmpegSource)
    ])
    for (const index of [0, 1]) {
      expect(positionsAfter[index].x).toBeCloseTo(positionsBefore[index].x, 0)
      expect(positionsAfter[index].y).toBeCloseTo(positionsBefore[index].y, 0)
    }

    await chooseSelectOption(ffmpegSource.locator('select'), 'managed')
    await expect(ffmpegTool.getByLabel('FFmpeg executable')).toHaveCount(0)
    await expect(ffmpegTool.getByRole('button', { name: 'Update FFmpeg and FFprobe' })).toBeVisible()
    await expect(externalSoftware.getByRole('combobox', { name: 'Managed Tool Updates' })).toBeVisible()
  })

  test('shows yt-dlp browsers dynamically and centers the optional profile field', async ({ app, page, attachScreenshot }) => {
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
      has: page.getByRole('heading', { name: 'yt-dlp Cookies', exact: true })
    })
    const cookieSource = authentication.locator('.restrictedPlaybackAuthSource select')
    const alwaysUseCookies = authentication.getByRole('checkbox', { name: /^Always Use Cookies/ })
    const subtitleCookies = authentication.getByRole('checkbox', { name: /^Use cookies for subtitles/ })
    const downloadCookies = authentication.getByRole('checkbox', { name: /^Use cookies for downloads/ })
    const authenticationHint = authentication.locator('.restrictedPlaybackAuthHint')
    const accountRestrictionWarning = authentication.locator(
      '.restrictedPlaybackAuthHint strong'
    )

    await expect(cookieSource.locator('option')).toHaveText(['None', 'File', 'Browser'])
    await expect(cookieSource).toHaveValue('none')
    await expect(downloadCookies).toBeChecked()
    await expect(downloadCookies).toBeEnabled()
    await downloadCookies.locator('..').locator('label.switch-label').click()
    await expect(downloadCookies).not.toBeChecked()
    await expect(alwaysUseCookies).not.toBeChecked()
    await expect(subtitleCookies).not.toBeChecked()
    await expect(subtitleCookies).toBeEnabled()
    await subtitleCookies.locator('..').locator('label.switch-label').click()
    await expect(subtitleCookies).toBeChecked()
    await expect(authenticationHint).toHaveText(
      'By default, OpenTubeX only passes these cookies to yt-dlp after you choose "Try with configured cookies" on an age-restricted or members-only video. Using yt-dlp with a Google account can lead to temporary or permanent account restrictions.'
    )
    await expect(accountRestrictionWarning).toHaveText(
      'Using yt-dlp with a Google account can lead to temporary or permanent account restrictions.'
    )

    await alwaysUseCookies.locator('..')
      .locator('.selectTooltip button')
      .focus()
    await expect(page.locator('body > [role="tooltip"]:visible')).toHaveText(
      "Use the configured cookies for downloads, subtitles and whenever yt-dlp extracts streams. This does not switch the stream extraction method to yt-dlp. With yt-dlp selected, account-only formats may become available, including YouTube Premium's enhanced bitrate when the account has access."
    )
    await chooseSelectOption(cookieSource, 'browser')

    const browser = authentication.locator('.restrictedPlaybackAuthDetail select')
    await expect(browser.locator('option')).toHaveText([
      'Select a browser',
      'Firefox',
      'Vivaldi'
    ])
    await chooseSelectOption(browser, 'firefox')

    const profile = authentication.getByPlaceholder('Profile name or path')
    await profile.fill('/tmp/firefox-profile')
    await alwaysUseCookies.locator('..').locator('label.switch-label').click()
    await expect(alwaysUseCookies).toBeChecked()
    await expect(downloadCookies).toBeChecked()
    await expect(downloadCookies).toBeDisabled()
    await expect(subtitleCookies).toBeChecked()
    await expect(subtitleCookies).toBeDisabled()
    await alwaysUseCookies.locator('..').locator('label.switch-label').click()
    await expect(downloadCookies).toBeEnabled()
    await expect(downloadCookies).not.toBeChecked()
    await expect(subtitleCookies).toBeEnabled()
    await expect(subtitleCookies).toBeChecked()
    await subtitleCookies.locator('..').locator('label.switch-label').click()
    await alwaysUseCookies.locator('..').locator('label.switch-label').click()
    await expect(subtitleCookies).toBeChecked()
    await expect(subtitleCookies).toBeDisabled()

    for (const highlightChangedSettings of [false, true]) {
      await page.evaluate(value => window.$store.dispatch('updateHighlightChangedSettings', value), highlightChangedSettings)
      for (const direction of ['ltr', 'rtl']) {
        await page.evaluate(value => { document.body.dir = value }, direction)
        const [sourceBox, browserBox, profileBox] = await Promise.all([
          authentication.locator('.restrictedPlaybackAuthSource .select-text').boundingBox(),
          authentication.locator('.restrictedPlaybackAuthDetail .select-text').boundingBox(),
          authentication.locator('.restrictedPlaybackBrowserProfile input').boundingBox()
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
      }
    }
    await page.evaluate(() => { document.body.dir = 'ltr' })

    await expect.poll(async () => {
      const settings = latestSettings(
        readDatastore(app.userDataDir, 'settings')
      )
      return {
        mode: settings.ytDlpPlaybackAuthMode,
        browser: settings.ytDlpPlaybackCookiesBrowser,
        profile: settings.ytDlpPlaybackCookiesBrowserProfile,
        alwaysUse: settings.ytDlpPlaybackAlwaysUseCookies
      }
    }).toEqual({
      mode: 'browser',
      browser: 'firefox',
      profile: '/tmp/firefox-profile',
      alwaysUse: true
    })
    await attachScreenshot('subtitle cookie settings')
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
