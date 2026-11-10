import { chmod, copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  choosePickerPaths,
  test,
  expect,
  expectOverlayScrollRange,
  expectScrollAtRenderedEnd,
  goTo,
  goToSettingsSection,
  setWindowSize
} from '../../helpers/app.mjs'
import { DEMO_MEDIA_PATH } from '../../helpers/media.mjs'

const ALPHA_CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const BETA_CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const EXTRA_CHANNELS = Array.from({ length: 20 }, (_, index) => ({
  id: `UC${String(index).padStart(22, '0')}`,
  name: `Extra Channel ${index + 1}`,
  thumbnail: ''
}))
const PROFILES = [
  {
    _id: 'allChannels',
    name: 'All Channels',
    bgColor: '#000000',
    textColor: '#FFFFFF',
    subscriptions: [
      { id: ALPHA_CHANNEL_ID, name: 'Alpha Channel', thumbnail: '' },
      { id: BETA_CHANNEL_ID, name: 'Beta Channel', thumbnail: '' },
      ...EXTRA_CHANNELS
    ]
  }
]
const AUTOMATIC_RULE = {
  template: 'video:best',
  enabledAt: Date.parse('2026-08-14T01:00:00.500Z'),
  includeVideos: true,
  minDurationSeconds: 60,
  maxDurationSeconds: 180,
  minFileSizeMb: 5,
  maxFileSizeMb: 25,
  maxAgeDays: 7,
  titleIncludes: 'Automatic',
  titleExcludes: 'Trailer'
}

async function scrollToBottom(scroller) {
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
}

// Offline refreshes of the seeded subscriptions fail and leave an error toast that can cover the editor.
test.use({
  seed: {
    profiles: PROFILES,
    settings: { currentLocale: 'en-US', fetchSubscriptionsAutomatically: false }
  }
})

test.describe('download progress', () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US' },
      history: [{
        _id: 'jNQXAC9IVRw',
        videoId: 'jNQXAC9IVRw',
        title: 'Download progress fixture',
        author: 'Test channel',
        lengthSeconds: 60,
        timeWatched: 1000,
        watchProgress: 0,
        type: 'video'
      }]
    }
  })

  test('scrolls long download errors with overlay scrollbars', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
    const setDownload = download => page.evaluate(download => {
      window.$store.commit('upsertYtDlpDownload', {
        id: 42,
        videoId: 'jNQXAC9IVRw',
        title: 'Download progress fixture',
        mode: 'video',
        percent: 40,
        speed: null,
        eta: null,
        errorMessage: null,
        ...download
      })
    }, download)
    await setWindowSize(app, page, { width: 1000, height: 600 })
    await setDownload({ status: 'downloading' })
    await goTo(page, 'history')
    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.title').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Download Video', exact: true }).click()
    const prompt = page.locator('.activeDownloadCard')
    await expect(prompt.locator('.downloadStatusLine')).toHaveText(/40\.0%/)

    const errorLines = Array.from({ length: 60 }, (_, index) => `ERROR: [youtube] jNQXAC9IVRw: fragment ${index + 1} failed`)
    await setDownload({ status: 'failed', errorMessage: errorLines.join('\n') })
    const progress = prompt.locator('.downloadProgress')
    await expect(prompt.locator('.downloadErrorDetails')).toBeVisible()
    await expect(progress).toHaveAttribute('data-overlayscrollbars-viewport', '')
    // The bar measures the new range on a later frame.
    await expect.poll(() => progress.evaluate(element => ({
      overflows: element.scrollHeight - element.clientHeight > 1,
      nativeScrollbar: getComputedStyle(element).scrollbarWidth,
      overlayScrollbar: element.querySelector(':scope > .os-scrollbar-vertical:not(.os-scrollbar-unusable)') !== null
    }))).toEqual({ overflows: true, nativeScrollbar: 'none', overlayScrollbar: true })

    await scrollToBottom(progress)
    await expectScrollAtRenderedEnd(progress)
    await expectOverlayScrollRange(progress)
    if (uiScale === 100) await prompt.screenshot({ path: testInfo.outputPath('download-progress-scrollbar.png') })

    // A taller window shows more of the error at once.
    await setWindowSize(app, page, { width: 1001, height: 800 })
    await expectOverlayScrollRange(progress)

    // Retrying the download from the downloads list removes the error.
    await scrollToBottom(progress)
    await setDownload({ status: 'downloading' })
    await expect(prompt.locator('.downloadErrorDetails')).toHaveCount(0)
    await expectOverlayScrollRange(progress)
  })
})

test.describe('download settings', () => {
  test('template controls keep desktop columns and helpers inside narrow windows', { tag: '@scale' }, async ({ app, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await goToSettingsSection(page, 'download')
    await page.getByRole('button', { name: 'Manage Download Templates (0)' }).click()
    const options = page.locator('.templateOptions')
    expect.soft(await options.locator('.optionGrid').first().evaluate(element => getComputedStyle(element).display)).toBe('grid')
    const grids = options.locator('.optionGrid')
    for (const grid of await grids.all()) {
      const boxes = await grid.locator(':scope > *').evaluateAll(elements => elements.slice(0, 2).map(element => element.getBoundingClientRect().top))
      expect.soft(Math.abs(boxes[0] - boxes[1])).toBeLessThanOrEqual(1)
    }
    await setWindowSize(app, page, { width: 400, height: 901 })
    for (const direction of ['ltr', 'rtl']) {
      await page.evaluate(value => { document.body.dir = value }, direction)
      expect.soft(await options.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      const outside = await options.evaluate(element => {
        const viewport = element.getBoundingClientRect()
        return Array.from(element.querySelectorAll('.inputIndicators')).filter(indicators => {
          const bounds = indicators.getBoundingClientRect()
          return bounds.width > 0 && (bounds.left < viewport.left - 1 || bounds.right > viewport.right + 1)
        }).map(indicators => indicators.className)
      })
      expect.soft(outside, direction).toEqual([])
    }
    await scrollToBottom(options)
    await setWindowSize(app, page, { width: 1600, height: 1000 })
    // Scroll anchoring can retain a position before the new end. Check that
    // the offset and thumb fit the rendered range before scrolling again.
    await expect.poll(() => options.evaluate(element => {
      const viewport = element.getBoundingClientRect()
      const first = element.querySelector('.optionSection').getBoundingClientRect()
      const last = element.querySelector('.optionSection:last-of-type').getBoundingClientRect()
      const track = element.querySelector('.os-scrollbar-vertical .os-scrollbar-track').getBoundingClientRect()
      const handle = element.querySelector('.os-scrollbar-vertical .os-scrollbar-handle').getBoundingClientRect()
      const expectedHandleHeight = track.height * viewport.height / (last.bottom - first.top)
      return Math.max(-element.scrollTop, viewport.bottom - last.bottom,
        Math.abs(handle.height - expectedHandleHeight)) * devicePixelRatio
    })).toBeLessThanOrEqual(2)
    await expect(options.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-visible/)
    await scrollToBottom(options)
    await expectScrollAtRenderedEnd(options)
  })

  test('creates templates from built-in and custom templates', async ({ page }) => {
    await goToSettingsSection(page, 'download')

    await expect(page.getByText(
      'yt-dlp, FFmpeg, and FFprobe are configured in the External Software settings.',
      { exact: true }
    )).toHaveCount(0)
    await page.getByRole('button', { name: 'Manage Download Templates (0)' }).click()

    const header = page.locator('.templateManagerHeader')
    const source = header.getByRole('combobox', { name: 'Template to Edit or Use as a Base' })
    const name = header.getByRole('textbox', { name: 'Template Name' })

    await source.click()
    await page.locator(`#${await source.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Audio - MP3 (Built-in)', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Media Type' })).toHaveText('Audio')
    await name.fill('Podcast')
    await page.getByRole('button', { name: 'Save Template' }).click()

    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return JSON.parse(store.getters.getYtDlpDownloadTemplates)
    })).toEqual([
      expect.objectContaining({
        name: 'Podcast',
        options: expect.objectContaining({ mode: 'audio', audioFormat: 'mp3' })
      })
    ])

    // Toasts pause while hovered, so a click retried under one never lands.
    const waitForToasts = async () => {
      await page.mouse.move(0, 0)
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
    }
    await waitForToasts()
    await page.getByRole('button', { name: 'Create Copy' }).click()
    await expect(name).toHaveValue('Podcast Copy')
    await page.getByRole('button', { name: 'Save Template' }).click()

    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return JSON.parse(store.getters.getYtDlpDownloadTemplates).map(template => template.name)
    })).toEqual(['Podcast', 'Podcast Copy'])

    await name.fill('Podcast')
    await waitForToasts()
    await page.getByRole('button', { name: 'Save Template' }).click()
    await expect(page.getByText('A download template named "Podcast" already exists.')).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return JSON.parse(store.getters.getYtDlpDownloadTemplates).map(template => template.name)
    })).toEqual(['Podcast', 'Podcast Copy'])
  })

  test('automatic download types wrap translated labels across breakpoints', { tag: '@scale' }, async ({ page }) => {
    await goToSettingsSection(page, 'download')
    await page.getByRole('button', { name: 'Manage Automatic Downloads (0)' }).click()
    const manager = page.locator('.settingsSubpageContent')
    const channel = manager.locator('.channelRule').first()
    await channel.locator('.channelToggle .switch-label').click()
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUseAITranslationCompletions', true)
      await store.dispatch('updateCurrentLocale', 'el')
    })
    await expect(channel.locator('.templateAndTypes')).toContainText('Ζωντανές μεταδόσεις')
    for (const width of [1100, 800, 761, 760, 650, 610, 601, 600]) {
      await manager.evaluate((element, width) => { element.style.inlineSize = `${width}px` }, width)
      const overflow = await channel.evaluate(element => {
        const card = element.getBoundingClientRect()
        const parent = element.parentElement.getBoundingClientRect()
        const labels = [...element.querySelectorAll('.templateAndTypes .switch-label-text')]
        return Math.max(card.right - parent.right, parent.left - card.left,
          ...labels.map(label => label.scrollWidth - label.clientWidth))
      })
      expect(overflow, `${width}px translated controls`).toBeLessThanOrEqual(1)
    }
  })

  test('clamps the automatic download manager after dynamic content changes', { tag: '@scale' }, async ({ app, page }) => {
    await goToSettingsSection(page, 'download')
    await page.getByRole('button', { name: 'Manage Automatic Downloads (0)' }).click()

    const manager = page.locator('.settingsSubpageContent')
    const search = manager.getByRole('searchbox', { name: 'Search channels' })
    const scroller = manager.locator('.automaticDownloadsScroller')
    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
    await scrollToBottom(scroller)
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

    await search.fill('beta')
    await expect(manager.getByText('Beta Channel', { exact: true })).toBeVisible()
    await expect(manager.getByText('Alpha Channel', { exact: true })).toHaveCount(0)
    await expectScrollAtRenderedEnd(scroller)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)

    await manager.getByText('Beta Channel', { exact: true }).click()
    await expect.poll(() => page.evaluate((channelId) => {
      const store = window.$store
      return JSON.parse(store.getters.getYtDlpAutomaticDownloadRules)[channelId]
    }, BETA_CHANNEL_ID)).toEqual(expect.objectContaining({
      template: 'video:best',
      includeVideos: true,
      includeShorts: false,
      includeLivestreams: false,
      enabledAt: expect.any(Number)
    }))

    const options = manager.locator('.templateAndTypes')
    await page.getByRole('button', { name: 'Maximize' }).click()
    await setWindowSize(app, page, { width: 560, height: 800 })
    await expect.poll(() => manager.evaluate(element => element.clientWidth)).toBeLessThanOrEqual(600)
    await scrollToBottom(scroller)
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

    await manager.getByText('Beta Channel', { exact: true }).click()
    await expect(options).toHaveCount(0)
    await expectScrollAtRenderedEnd(scroller)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)

    // Observe the saved removal so the final check cannot match the earlier rule.
    await expect.poll(() => page.evaluate(channelId => (
      JSON.parse(window.$store.getters.getYtDlpAutomaticDownloadRules)[channelId]
    ), BETA_CHANNEL_ID)).toBeUndefined()

    await manager.getByText('Beta Channel', { exact: true }).click()
    await expect(options).toBeVisible()
    await scrollToBottom(scroller)
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

    await setWindowSize(app, page, { width: 1200, height: 1000 })
    await expect.poll(() => manager.evaluate(element => element.clientWidth)).toBeGreaterThan(760)
    await expectScrollAtRenderedEnd(scroller)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)

    // The editor is optimistic; relaunch only after the re-enabled rule is saved.
    await expect.poll(() => page.evaluate(channelId => (
      JSON.parse(window.$store.getters.getYtDlpAutomaticDownloadRules)[channelId]
    ), BETA_CHANNEL_ID)).toEqual(expect.objectContaining({ includeVideos: true }))

    const { page: relaunchedPage } = await app.relaunch()
    await goToSettingsSection(relaunchedPage, 'download')
    await expect(relaunchedPage.getByRole('button', { name: 'Manage Automatic Downloads (1)' })).toBeVisible()
  })
})

test.describe('automatic download authorization', () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'en-US',
        ytDlpAutomaticDownloadRules: JSON.stringify({ [BETA_CHANNEL_ID]: AUTOMATIC_RULE })
      },
      profiles: PROFILES
    }
  })

  test('starts filtered automatic downloads only for the active subscription refresh', async ({ app, page }) => {
    const executable = path.join(app.userDataDir, 'fake-automatic-yt-dlp.sh')
    const downloadedFile = path.join(app.userDataDir, 'automatic.webm')
    const argumentsFile = path.join(app.userDataDir, 'automatic-yt-dlp-arguments.txt')
    const metadataLookupsFile = path.join(app.userDataDir, 'automatic-yt-dlp-metadata-lookups.txt')
    const releaseDownloadFile = path.join(app.userDataDir, 'release-automatic-download')
    await app.electronApp.evaluate(({ BrowserWindow, Notification }) => {
      Notification.isSupported = () => true
      // The system shows notifications while the app is not in use.
      BrowserWindow.getFocusedWindow = () => null
      globalThis.automaticDownloadNotifications = []
      Notification.prototype.show = function () {
        globalThis.automaticDownloadNotifications.push(this)
      }
    })
    await copyFile(DEMO_MEDIA_PATH, downloadedFile)
    await writeFile(executable, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then printf \'%s\\n\' \'2026.08.19\'; exit; fi',
      'for argument in "$@"; do',
      '  if [ "$argument" = "--dump-single-json" ]; then',
      `    printf '%s\\n' metadata >> ${metadataLookupsFile}`,
      '    case "$*" in',
      `      *ccccccccccc*) printf '%s\\n' '{"id":"ccccccccccc","channel_id":"${BETA_CHANNEL_ID}","timestamp":1786669200}' ;;`,
      `      *ddddddddddd*) printf '%s\\n' '{"id":"ddddddddddd","channel_id":"${BETA_CHANNEL_ID}","timestamp":1786665599}' ;;`,
      "      *eeeeeeeeeee*) printf '%s\\n' 'null' ;;",
      '    esac',
      '    exit 0',
      '  fi',
      'done',
      `printf '%s\\n' "$@" > ${argumentsFile}`,
      `while [ ! -f "${releaseDownloadFile}" ]; do sleep 0.05; done`,
      `printf '__OPENTUBEX_FILE__:ccccccccccc\\t120\\t640\\t360\\t%s\\n' '${downloadedFile}'`
    ].join('\n'))
    await chmod(executable, 0o755)
    await choosePickerPaths(app, page, { ytDlpPath: executable, ytDlpDownloadFolderPath: app.userDataDir })

    const payload = {
      videoId: 'ccccccccccc',
      title: 'Automatic video',
      mode: 'video',
      template: 'video:best',
      automatic: true,
      channelId: BETA_CHANNEL_ID,
      automaticMediaType: 'video',
      minDurationSeconds: 60,
      maxDurationSeconds: 180,
      minFileSizeMb: 5,
      maxFileSizeMb: 25,
      maxAgeDays: 7,
      enabledAt: 1,
      titleIncludes: 'Injected',
      titleExcludes: '',
      customArgs: '--write-description',
      videoIds: ['eeeeeeeeeee'],
      isPlaylist: true,
      playlistId: 'PL1234567890',
      notification: {
        startedTitle: 'Automatic download started',
        startedBody: 'Automatic video is downloading',
        completedTitle: 'Automatic download finished',
        completedBody: 'Automatic video was downloaded'
      }
    }
    expect(await page.evaluate((download) => window.ftElectron.ytDlpDownload(download), payload)).toBeNull()

    if ((await page.evaluate(() => window.ftElectron.subscriptionAutoRefresh.isInProgress())).inProgress) {
      await page.evaluate(() => window.ftElectron.subscriptionAutoRefresh.cancel())
      await expect.poll(() => page.evaluate(async () => (
        await window.ftElectron.subscriptionAutoRefresh.isInProgress()
      ).inProgress)).toBe(false)
    }

    const refreshOwnerTabId = await page.evaluate(async () => {
      const store = window.$store
      const tabId = store.getters.getActiveTabId
      return await window.ftElectron.subscriptionAutoRefresh.acquire(tabId, 'videos') ? tabId : null
    })
    expect(refreshOwnerTabId).not.toBeNull()
    const authorizedPayload = { ...payload, refreshOwnerTabId }

    expect(await page.evaluate((download) => window.ftElectron.ytDlpDownload(download), {
      ...authorizedPayload,
      channelId: ALPHA_CHANNEL_ID
    })).toBeNull()
    expect(await page.evaluate((download) => window.ftElectron.ytDlpDownload(download), {
      ...authorizedPayload,
      videoId: 'ddddddddddd'
    })).toBeNull()
    expect(await page.evaluate((download) => window.ftElectron.ytDlpDownload(download), {
      ...authorizedPayload,
      videoId: 'eeeeeeeeeee'
    })).toBeNull()

    const concurrentResults = await page.evaluate((download) => Promise.all([
      window.ftElectron.ytDlpDownload(download),
      window.ftElectron.ytDlpDownload(download)
    ]), authorizedPayload)
    const result = concurrentResults.find(download => 'id' in download)
    expect(concurrentResults).toContainEqual({ skipped: 'already-downloaded' })
    expect(result).toEqual({ id: expect.any(Number) })

    await expect.poll(() => app.electronApp.evaluate(() => (
      globalThis.automaticDownloadNotifications.map(notification => notification.title)
    ))).toContain('Automatic download started')
    await app.electronApp.evaluate(() => {
      globalThis.automaticDownloadNotifications
        .find(notification => notification.title === 'Automatic download started')
        .emit('click')
    })
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getSettingsWindowView
    })).toBe('downloads')

    const tabCount = await page.evaluate(() => {
      const store = window.$store
      return store.getters.getTabCount
    })
    await writeFile(releaseDownloadFile, '')
    await expect.poll(() => page.evaluate(async (id) => {
      return (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)?.status
    }, result.id)).toBe('completed')
    await expect.poll(() => app.electronApp.evaluate(() => (
      globalThis.automaticDownloadNotifications.map(notification => notification.title)
    ))).toContain('Automatic download finished')
    await app.electronApp.evaluate(() => {
      globalThis.automaticDownloadNotifications
        .find(notification => notification.title === 'Automatic download finished')
        .emit('click')
    })
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return {
        tabCount: store.getters.getTabCount,
        route: store.getters.getActiveTab?.route.fullPath
      }
    })).toEqual({
      tabCount: tabCount + 1,
      route: `/watch/ccccccccccc?downloadId=${result.id}`
    })
    await expect(page.locator('.videoPlayerPlaceholder.ft-shimmer')).toHaveCount(0)
    await expect(page.locator('.legacy-quality-button')).toHaveAttribute('shaka-status', '640×360 • Local file')

    const args = (await readFile(argumentsFile, 'utf8')).trim().split('\n')
    expect(args).toEqual(expect.arrayContaining([
      '--match-filter',
      `channel_id = ${BETA_CHANNEL_ID} & duration >= 60 & duration <= 180`,
      '--min-filesize',
      '5M',
      '--max-filesize',
      '25M',
      '--dateafter',
      'now-7days',
      '--match-title',
      '(?i)^(?=.*(?:Automatic))(?!.*(?:Trailer)).*$',
      '--no-overwrites'
    ]))
    expect(args).not.toContain('--write-description')
    expect(args).toContain('https://www.youtube.com/watch?v=ccccccccccc')
    expect(args).not.toContain('https://www.youtube.com/watch?v=eeeeeeeeeee')
    expect(args).not.toContain('https://www.youtube.com/playlist?list=PL1234567890')

    const metadataLookupsBeforeDuplicate = await readFile(metadataLookupsFile, 'utf8')
    const duplicate = await page.evaluate((download) => window.ftElectron.ytDlpDownload(download), authorizedPayload)
    expect(duplicate).toEqual({ skipped: 'already-downloaded' })
    expect(await readFile(metadataLookupsFile, 'utf8')).toBe(metadataLookupsBeforeDuplicate)
    await page.evaluate((tabId) => window.ftElectron.subscriptionAutoRefresh.release(tabId), refreshOwnerTabId)
  })
  test('keeps automatic downloads waiting on battery power when charging is required', async ({ app, page }) => {
    const executable = path.join(app.userDataDir, 'fake-charging-yt-dlp.sh')
    const startedFile = path.join(app.userDataDir, 'started-ccccccccccc')
    await writeFile(executable, [
      '#!/bin/sh',
      'for argument in "$@"; do',
      '  if [ "$argument" = "--dump-single-json" ]; then',
      `    printf '%s\\n' '{"id":"ccccccccccc","channel_id":"${BETA_CHANNEL_ID}","timestamp":1786669200}'`,
      '    exit 0',
      '  fi',
      '  case "$argument" in https://www.youtube.com/watch?v=*) touch "' + app.userDataDir + '/started-$' + '{argument##*=}" ;; esac',
      'done'
    ].join('\n'))
    await chmod(executable, 0o755)
    await app.electronApp.evaluate(({ powerMonitor }) => {
      globalThis.onBatteryPower = true
      powerMonitor.isOnBatteryPower = () => globalThis.onBatteryPower
    })
    await choosePickerPaths(app, page, { ytDlpPath: executable })
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateYtDlpAutomaticDownloadsRequireCharging', true)
    })

    if ((await page.evaluate(() => window.ftElectron.subscriptionAutoRefresh.isInProgress())).inProgress) {
      await page.evaluate(() => window.ftElectron.subscriptionAutoRefresh.cancel())
      await expect.poll(() => page.evaluate(async () => (
        await window.ftElectron.subscriptionAutoRefresh.isInProgress()
      ).inProgress)).toBe(false)
    }
    const refreshOwnerTabId = await page.evaluate(async () => {
      const tabId = window.$store.getters.getActiveTabId
      return await window.ftElectron.subscriptionAutoRefresh.acquire(tabId, 'videos') ? tabId : null
    })
    expect(refreshOwnerTabId).not.toBeNull()

    const result = await page.evaluate((download) => window.ftElectron.ytDlpDownload(download), {
      videoId: 'ccccccccccc',
      title: 'Automatic charging video',
      mode: 'video',
      template: 'video:best',
      automatic: true,
      channelId: BETA_CHANNEL_ID,
      automaticMediaType: 'video',
      refreshOwnerTabId
    })
    expect(result).toEqual({ id: expect.any(Number) })
    // Manual downloads ignore the requirement.
    await expect.poll(async () => {
      await page.bringToFront()
      return page.evaluate(() => window.ftElectron.ytDlpDownload({
        videoId: 'ddddddddddd', title: 'Manual battery video', mode: 'video'
      }))
    }).toEqual({ id: expect.any(Number) })

    const status = id => page.evaluate(async (id) => (
      (await window.ftElectron.ytDlpListDownloads()).find(download => download.id === id)
    ), id)
    await expect.poll(() => readFile(path.join(app.userDataDir, 'started-ddddddddddd')).then(() => true, () => false)).toBe(true)
    await expect.poll(async () => (await status(result.id))?.waitingFor).toBe('charging')
    // The automatic download was queued first, so the drain that started the
    // manual download has already decided to hold it back.
    expect(await status(result.id)).toEqual(expect.objectContaining({ status: 'queued', started: false }))
    expect(await readFile(startedFile).then(() => true, () => false)).toBe(false)
    await goTo(page, 'downloads')
    await expect(page.locator('.downloadRow').filter({ hasText: 'Automatic charging video' })).toContainText('Waiting for a charger')

    await app.electronApp.evaluate(({ powerMonitor }) => {
      globalThis.onBatteryPower = false
      powerMonitor.emit('on-ac')
    })
    await expect.poll(() => readFile(startedFile).then(() => true, () => false)).toBe(true)
    await expect(page.locator('.downloadRow').filter({ hasText: 'Automatic charging video' })).not.toContainText('Waiting for a charger')
    await page.evaluate((tabId) => window.ftElectron.subscriptionAutoRefresh.release(tabId), refreshOwnerTabId)
  })
})
