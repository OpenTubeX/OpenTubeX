import { DBActions } from '../../../src/constants.js'
import { test, expect, goTo, goToSettingsSection, latestSettings, readDatastore } from '../../helpers/app.mjs'

async function expectDownloadQueueSettingsAlignment(page) {
  const downloads = await goToSettingsSection(page, 'download')
  const enableDownloads = downloads.getByRole('checkbox', { name: 'Enable Downloads' })
  if (!await enableDownloads.isChecked()) {
    await downloads.locator('label.switch-label').filter({ hasText: 'Enable Downloads' }).click()
  }

  const bounds = await downloads.evaluate(element => {
    const pathInputs = element.querySelectorAll('.downloadPathInputs .ft-input')
    const queueSelect = element.querySelector('.downloadQueueInputs .select-text')
    const queueSelectLabel = element.querySelector('.downloadQueueInputs .select-label')
    const bandwidthInput = element.querySelector('.downloadQueueInputs .ft-input')
    const bandwidthLabel = element.querySelector('.downloadQueueInputs .selectLabel')

    return {
      folder: pathInputs[0].getBoundingClientRect().toJSON(),
      customArguments: pathInputs[1].getBoundingClientRect().toJSON(),
      queueSelect: queueSelect.getBoundingClientRect().toJSON(),
      queueSelectLabel: queueSelectLabel.getBoundingClientRect().toJSON(),
      bandwidthInput: bandwidthInput.getBoundingClientRect().toJSON(),
      bandwidthLabel: bandwidthLabel.getBoundingClientRect().toJSON()
    }
  })

  expect(Math.abs(bounds.folder.x - bounds.queueSelect.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(bounds.customArguments.x - bounds.bandwidthInput.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(bounds.queueSelect.y - bounds.bandwidthInput.y)).toBeLessThanOrEqual(1)
  // Both outlined controls float their labels across the top border.
  expect(Math.abs(bounds.queueSelectLabel.y + bounds.queueSelectLabel.height / 2 - bounds.queueSelect.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(bounds.bandwidthLabel.y + bounds.bandwidthLabel.height / 2 - bounds.bandwidthInput.y)).toBeLessThanOrEqual(1)
}

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

    await ytDlpSource.locator('select').selectOption('managed')
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

    await ffmpegSource.locator('select').selectOption('managed')
    await expect(ffmpegTool.getByLabel('FFmpeg executable')).toHaveCount(0)
    await expect(ffmpegTool.getByRole('button', { name: 'Update FFmpeg and FFprobe' })).toBeVisible()
    await expect(externalSoftware.getByRole('combobox', { name: 'Managed Tool Updates' })).toBeVisible()
  })

  test('shows separate FFmpeg and FFprobe statuses when their versions differ', async ({ app, page }) => {
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
        ffprobe: { source: options.ffmpegSource, available: true, version: '8.1' }
      }))
    })

    const advanced = await goToSettingsSection(page, 'advanced')
    const ffmpegStatus = advanced.locator('.externalSoftwareTool').nth(1).locator('.externalSoftwareToolStatus')

    await expect(ffmpegStatus.locator('p')).toHaveText([
      'Detected FFmpeg version: 8.0',
      'Detected FFprobe version: 8.1'
    ])
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
      for (const width of [1000, 400]) {
        await page.setViewportSize({ width, height: 800 })
        if (width < 760) {
          // The window maximizes from its resize listener on a later frame, and its
          // content observer follows. Measuring earlier can straddle the switch.
          await expect(page.locator('.settingsWindow')).toHaveClass(/\bmaximized\b/)
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        }
        const [ytDlpBox, ffmpegBox] = await Promise.all([
          tools.nth(0).boundingBox(),
          tools.nth(1).boundingBox()
        ])

        expect(ffmpegBox.y).toBeGreaterThan(ytDlpBox.y + ytDlpBox.height)

        await expectExternalSoftwarePathAlignment(
          tools.nth(0),
          'yt-dlp Source',
          'yt-dlp executable'
        )
        await expectExternalSoftwarePathAlignment(
          tools.nth(1),
          'FFmpeg Source',
          'FFmpeg executable'
        )
      }
      for (const tool of [tools.nth(0), tools.nth(1)]) {
        await tool.locator('.externalSoftwareSelect select').first().selectOption('managed')
      }
      const managed = advanced.locator('.managedSoftwareControls')
      await expect(managed).toBeVisible()
      const geometry = await managed.evaluate(element => {
        const container = element.getBoundingClientRect()
        const field = element.querySelector('.select-text').getBoundingClientRect()
        const indicators = element.querySelector('.selectIndicators').getBoundingClientRect()
        return {
          center: Math.abs(field.left + field.width / 2 - container.left - container.width / 2),
          overflow: Math.max(container.left - indicators.left, indicators.right - container.right)
        }
      })
      expect(geometry.center).toBeLessThanOrEqual(1)
      expect(geometry.overflow).toBeLessThanOrEqual(1)
    })
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

  test('aligns the download queue controls with the other fields', { tag: '@scale' }, async ({ page }) => {
    await expectDownloadQueueSettingsAlignment(page)
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
        readDatastore(app.userDataDir, 'settings')
      ).externalSoftwareUpdateMode
    }).toBe('manual')
  })
})

test.describe('managed external software download errors', () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'de-DE',
        ytDlpSource: 'managed',
        externalSoftwareUpdateMode: 'manual'
      }
    }
  })

  test('translates a managed yt-dlp download that antivirus software removed', async ({ app, page }) => {
    await app.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('yt-dlp-download-binary')
      ipcMain.handle('yt-dlp-download-binary', () => ({
        error: 'The downloaded yt-dlp binary was removed',
        errorCode: 'MANAGED_TOOL_REMOVED'
      }))
    })

    const section = await goToSettingsSection(page, 'advanced')
    await section.locator('[aria-labelledby="yt-dlp-settings-heading"] .externalSoftwareToolAction').click()

    await expect(page.locator('.toast', {
      hasText: 'Herunterladen von yt-dlp fehlgeschlagen: Die heruntergeladene Datei wurde entfernt, höchstwahrscheinlich von einer Antivirensoftware'
    })).toBeVisible()
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
