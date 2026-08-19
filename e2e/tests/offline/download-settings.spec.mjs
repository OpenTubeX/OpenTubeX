import { chmod, copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'
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

async function expectScrollAtRenderedEnd(scroller) {
  await expect.poll(() => scroller.evaluate((element) => {
    const content = element.querySelector(':scope > div')
    const contentEnd = content.offsetTop + content.offsetHeight +
      Number.parseFloat(getComputedStyle(element).paddingBottom)
    const maximumScrollTop = Math.max(0, contentEnd - element.clientHeight)
    return Math.abs(element.scrollTop - maximumScrollTop)
  })).toBeLessThanOrEqual(1)
}

test.use({
  seed: {
    profiles: PROFILES
  }
})

test.describe('download settings', () => {
  test('stores global yt-dlp arguments and centers wrapped download actions', async ({ app, page }) => {
    await goToSettingsSection(page, 'download')

    const globalArguments = page.getByRole('textbox', { name: 'Global Additional yt-dlp Arguments' })
    await globalArguments.fill('--cookies-from-browser firefox')
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getYtDlpDownloadCustomArgs
    })).toBe('--cookies-from-browser firefox')

    await page.getByRole('button', { name: 'Maximize' }).click()
    await setWindowSize(app, page, { width: 1501, height: 751 })
    const actions = page.locator('.downloadActions')
    await expect.poll(() => actions.locator('.btn').evaluateAll(buttons => (
      new Set(buttons.map(button => button.offsetTop)).size
    ))).toBe(1)

    await setWindowSize(app, page, { width: 701, height: 801 })
    const wrappedGeometry = await actions.evaluate(element => {
      const container = element.getBoundingClientRect()
      const buttons = [...element.querySelectorAll('.btn')].map(button => button.getBoundingClientRect())
      return {
        containerCenter: container.x + container.width / 2,
        centers: buttons.map(button => button.x + button.width / 2),
        tops: buttons.map(button => button.y),
        actionsBottom: container.bottom
      }
    })
    expect(wrappedGeometry.tops[0]).toBeCloseTo(wrappedGeometry.tops[1], 0)
    expect(wrappedGeometry.tops[2]).toBeGreaterThan(wrappedGeometry.tops[0])
    expect(wrappedGeometry.centers[2]).toBeCloseTo(wrappedGeometry.containerCenter, 0)

    const inputsTop = await page.getByRole('textbox', { name: 'Download Folder' })
      .evaluate(element => element.getBoundingClientRect().top)
    expect(inputsTop - wrappedGeometry.actionsBottom).toBeGreaterThanOrEqual(20)
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
    const [sourceBox, nameBox] = await Promise.all([source.boundingBox(), name.boundingBox()])
    expect(sourceBox.y).toBeCloseTo(nameBox.y, 0)
    expect(sourceBox.height).toBeCloseTo(nameBox.height, 0)

    await source.click()
    await page.locator(`#${await source.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Audio - MP3 (Built-in)', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Media Type' })).toHaveText('Audio')
    await name.fill('Podcast')
    await page.getByRole('button', { name: 'Save Template' }).click()

    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return JSON.parse(store.getters.getYtDlpDownloadTemplates)
    })).toEqual([
      expect.objectContaining({
        name: 'Podcast',
        options: expect.objectContaining({ mode: 'audio', audioFormat: 'mp3' })
      })
    ])

    await page.getByRole('button', { name: 'Create Copy' }).click()
    await expect(name).toHaveValue('Podcast Copy')
    await page.getByRole('button', { name: 'Save Template' }).click()

    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return JSON.parse(store.getters.getYtDlpDownloadTemplates).map(template => template.name)
    })).toEqual(['Podcast', 'Podcast Copy'])

    await name.fill('Podcast')
    await page.getByRole('button', { name: 'Save Template' }).click()
    await expect(page.getByText('A download template named "Podcast" already exists.')).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return JSON.parse(store.getters.getYtDlpDownloadTemplates).map(template => template.name)
    })).toEqual(['Podcast', 'Podcast Copy'])
  })

  test('clamps the automatic download manager after dynamic content changes', async ({ app, page }) => {
    await goToSettingsSection(page, 'download')
    await page.getByRole('button', { name: 'Manage Automatic Downloads (0)' }).click()

    const manager = page.locator('.settingsSubpageContent')
    const search = manager.getByRole('textbox', { name: 'Search channels' })
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return JSON.parse(store.getters.getYtDlpAutomaticDownloadRules)[channelId]
    }, BETA_CHANNEL_ID)).toEqual(expect.objectContaining({
      template: 'video:best',
      includeVideos: true,
      includeShorts: false,
      includeLivestreams: false,
      enabledAt: expect.any(Number)
    }))

    const options = manager.locator('.templateAndTypes')
    const geometry = await options.evaluate((row) => {
      const controls = [
        row.querySelector('.select-text'),
        ...row.querySelectorAll('.switch-label')
      ].map(element => element.getBoundingClientRect())
      return {
        centers: controls.map(box => box.y + box.height / 2),
        widths: controls.map(box => box.width)
      }
    })
    for (const center of geometry.centers.slice(1)) {
      expect(center).toBeCloseTo(geometry.centers[0], 0)
    }
    expect(geometry.widths[0]).toBeGreaterThan(geometry.widths[1])

    await page.getByRole('button', { name: 'Maximize' }).click()
    await setWindowSize(app, page, { width: 560, height: 800 })
    await expect.poll(() => manager.evaluate(element => element.clientWidth)).toBeLessThanOrEqual(600)
    await scrollToBottom(scroller)
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

    await manager.getByText('Beta Channel', { exact: true }).click()
    await expect(options).toHaveCount(0)
    await expectScrollAtRenderedEnd(scroller)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)

    await manager.getByText('Beta Channel', { exact: true }).click()
    await expect(options).toBeVisible()
    await scrollToBottom(scroller)
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

    await setWindowSize(app, page, { width: 1200, height: 900 })
    await expect.poll(() => manager.evaluate(element => element.clientWidth)).toBeGreaterThan(760)
    await expectScrollAtRenderedEnd(scroller)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)

    const { page: relaunchedPage } = await app.relaunch()
    await goToSettingsSection(relaunchedPage, 'download')
    await expect(relaunchedPage.getByRole('button', { name: 'Manage Automatic Downloads (1)' })).toBeVisible()
  })
})

test.describe('automatic download authorization', () => {
  test.use({
    seed: {
      settings: {
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
    await app.electronApp.evaluate(({ Notification }) => {
      Notification.isSupported = () => true
      globalThis.automaticDownloadNotifications = []
      Notification.prototype.show = function () {
        globalThis.automaticDownloadNotifications.push(this)
      }
    })
    await copyFile(DEMO_MEDIA_PATH, downloadedFile)
    await writeFile(executable, [
      '#!/bin/sh',
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
    await page.evaluate(async (ytDlpPath) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateYtDlpPath', ytDlpPath)
    }, executable)

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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getSettingsWindowView
    })).toBe('downloads')

    const tabCount = await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
})
