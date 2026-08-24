import { IpcChannels } from '../../../src/constants.js'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, goToSettingsSection, setWindowSize, test } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      currentLocale: 'en-US',
      enableVideoMetadataCache: true,
      historyRetentionDays: '30'
    },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      subscriptions: [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Channel A' }]
    }],
    searchHistory: [{ _id: 'saved search', lastUpdatedAt: 1 }],
    subscriptionCache: [{
      _id: 'UCaaaaaaaaaaaaaaaaaaaaaa',
      videos: [{ videoId: 'aaaaaaaaaaa', title: 'Cached video' }],
      videosTimestamp: 1
    }]
  }
})

test('calculates storage usage only after the Storage tab opens', async ({ app, page }) => {
  await app.electronApp.evaluate(({ ipcMain }, channel) => {
    globalThis.__storageUsageReadCount = 0
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => {
      globalThis.__storageUsageReadCount++
      return { profileTotal: 0, otherProfileData: 0 }
    })
  }, IpcChannels.STORAGE_GET_USAGE)

  const dataAndStorage = await goToSettingsSection(page, 'data')
  expect(await app.electronApp.evaluate(() => globalThis.__storageUsageReadCount)).toBe(0)
  await expect(dataAndStorage.locator('[data-settings-tab="data"]'))
    .toHaveAttribute('aria-selected', 'true')
  await expect(dataAndStorage.locator('[data-settings-tab="data"] [data-icon="layer-group"]'))
    .toBeVisible()
  await expect(dataAndStorage.locator('[data-settings-tab="storage"] [data-icon="database"]'))
    .toBeVisible()
  await expect(dataAndStorage.locator('.storageBreakdown')).toHaveCount(0)

  const settingsContent = page.locator('.settingsContent')
  await settingsContent.evaluate(element => { element.scrollTop = 100 })
  const storageTab = dataAndStorage.locator('[data-settings-tab="storage"]')
  await dataAndStorage.locator('[data-settings-tab="data"]').focus()
  await page.keyboard.press('ArrowRight')
  await expect(storageTab).toBeFocused()
  await expect(storageTab).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => settingsContent.evaluate(element => element.scrollTop)).toBe(0)
  await expect.poll(() => app.electronApp.evaluate(
    () => globalThis.__storageUsageReadCount
  )).toBe(1)
})

test('moves storage controls into one searchable category', async ({ app, attachScreenshot, page }) => {
  const mebibyte = 1024 * 1024
  await app.electronApp.evaluate(({ ipcMain }, { channels, mebibyte }) => {
    ipcMain.removeHandler(channels.STORAGE_GET_USAGE)
    ipcMain.handle(channels.STORAGE_GET_USAGE, () => ({
      downloadRecords: mebibyte,
      videoMetadata: 8 * mebibyte,
      subscriptionCache: 4 * mebibyte,
      searchHistory: mebibyte,
      history: 6 * mebibyte,
      watchStats: 2 * mebibyte,
      playlists: 10 * mebibyte,
      profiles: 2 * mebibyte,
      settings: mebibyte,
      tabSessions: 3 * mebibyte,
      liveReminders: mebibyte,
      ytDlpPlayback: mebibyte,
      httpCache: 10 * mebibyte,
      tabPreviews: 2 * mebibyte,
      playerCache: 3 * mebibyte,
      browserCacheData: 5 * mebibyte,
      browserRuntimeData: 5 * mebibyte,
      otherProfileData: 10 * mebibyte,
      profileTotal: 75 * mebibyte
    }))
    ipcMain.removeHandler(channels.YT_DLP_LIST_DOWNLOADS)
    ipcMain.handle(channels.YT_DLP_LIST_DOWNLOADS, () => [{
      id: 'storage-preview-download',
      status: 'completed',
      sizeBytes: 20 * mebibyte
    }])
  }, { channels: IpcChannels, mebibyte })

  const storage = await goToSettingsSection(page, 'storage')

  await expect(storage.getByRole('heading', { name: 'Downloads', exact: true })).toBeVisible()
  await expect(storage.getByRole('heading', { name: 'Replaceable caches' })).toBeVisible()
  await expect(storage.getByRole('heading', { name: 'Stored histories' })).toBeVisible()
  await expect(storage.getByRole('heading', { name: 'Other user data' })).toBeVisible()
  await expect(storage.getByRole('checkbox', { name: 'Metadata history' })).toBeChecked()
  await expect(storage.getByLabel('Automatic History Retention (Days)')).toHaveValue('30')
  await expect(storage.getByRole('checkbox', { name: 'Replace HTTP Cache' })).toHaveCount(0)
  await expect(storage.locator('.storageKind')).toHaveCount(0)
  await expect(storage.locator('.storageLocation').filter({ hasText: 'downloads.json' })
    .locator('[data-icon="file-lines"]')).toBeVisible()
  await expect(storage.locator('.storageLocation').filter({ hasText: 'subscription-cache.db' })
    .locator('[data-icon="file-lines"]')).toBeVisible()
  await expect(storage.locator('.storageLocation').filter({ hasText: 'tab-previews/' })
    .locator('[data-icon="folder-open"]')).toBeVisible()
  await expect(storage.getByText('Measured profile data')).toHaveCount(0)
  await expect(storage.getByRole('button', { name: 'Refresh sizes' })).toHaveCount(0)
  const cacheGrid = storage.getByRole('heading', { name: 'Replaceable caches' }).locator('..')
  await expect(cacheGrid).toHaveCSS(
    'grid-template-columns',
    /\d+(\.\d+)?px \d+(\.\d+)?px/
  )
  const breakdown = storage.locator('.storageBreakdown')
  await expect(storage.getByRole('heading', { name: 'Storage breakdown' })).toHaveCount(0)
  await expect(breakdown).toHaveAttribute('aria-label', /Storage breakdown/)
  await expect(breakdown.locator('.storageDonutCenter')).toContainText('95 MiB')
  await expect(breakdown.locator('li')).toHaveText([
    'Tracked downloaded media20 MiB21.1%',
    'Application caches10 MiB10.5%',
    'Browser caches15 MiB15.8%',
    'Stored app data35 MiB36.8%',
    'Browser runtime data5 MiB5.3%',
    'Other profile files10 MiB10.5%'
  ])
  await expect(breakdown.locator('.storageDonutSegment')).toHaveCount(6)
  await attachScreenshot('storage settings overview')

  const cacheSegment = breakdown.locator('[data-chart-segment="browser-caches"]')
  const chartBox = await breakdown.locator('.storageDonutChart').boundingBox()
  await page.mouse.move(
    chartBox.x + chartBox.width * 0.8,
    chartBox.y + chartBox.height * 0.73
  )
  await expect(breakdown.locator('.storageDonutTooltip')).toHaveText(
    'Browser caches15 MiB · 15.8%'
  )
  await attachScreenshot('storage chart tooltip')
  await cacheSegment.focus()
  await expect(breakdown.locator('.storageDonutTooltip')).toBeVisible()

  const otherFiles = breakdown.locator('li').filter({ hasText: 'Other profile files' })
  await otherFiles.getByRole('button').focus()
  await otherFiles.getByRole('button').hover()
  await expect(page.getByRole('tooltip').filter({ hasText: 'Backups, temporary files' })).toBeVisible()

  const settingsContent = page.locator('.settingsContent')
  await settingsContent.evaluate(element => { element.scrollTop = 80 })
  const returnScrollTop = await settingsContent.evaluate(element => element.scrollTop)
  expect(returnScrollTop).toBeGreaterThan(0)
  await storage.getByRole('button', { name: 'Open Downloads', exact: true }).click()
  const downloadsDialog = page.getByRole('dialog', { name: 'Downloads', exact: true })
  await expect(downloadsDialog.getByRole('button', { name: 'Back', exact: true })).toBeVisible()
  await attachScreenshot('downloads opened from storage settings')
  await downloadsDialog.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(storage).toBeVisible()
  await expect.poll(async () => Math.abs(
    await settingsContent.evaluate(element => element.scrollTop) - returnScrollTop
  )).toBeLessThanOrEqual(1)

  const privacy = await goToSettingsSection(page, 'privacy')
  await expect(privacy.getByRole('checkbox', { name: 'Metadata history' })).toHaveCount(0)
  await expect(privacy.getByLabel('Automatic History Retention (Days)')).toHaveCount(0)
  await expect(privacy.getByRole('button', { name: 'Remove Watch History' })).toHaveCount(0)

  const search = page.getByRole('searchbox', { name: 'Search settings' })
  await search.fill('Automatic History Retention')
  await page.getByRole('button', { name: 'Automatic History Retention (Days)', exact: true }).click()
  await expect(page.locator('.settingsContent > [data-section="data"]')).toBeVisible()
  await expect(page.locator('[data-settings-tab="storage"]')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Automatic History Retention (Days)')).toHaveClass(/settingsSearchTarget/)

  await search.fill('Clear Search History and Cache')
  await page.getByRole('button', { name: 'Clear Search History and Cache', exact: true }).click()
  await expect(page.locator('.settingsContent > [data-section="data"]')).toBeVisible()
  await expect(page.locator('[data-settings-tab="storage"]')).toHaveAttribute('aria-selected', 'true')
})

test('separates replaceable search results from saved search history', async ({ page }) => {
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('addToSessionSearchHistory', {
      query: 'temporary search',
      data: [{ videoId: 'aaaaaaaaaaa' }]
    })
  })

  const storage = await goToSettingsSection(page, 'storage')
  const sessionCache = storage.locator('.storageItem').filter({
    has: page.getByRole('heading', { name: 'Session search cache', exact: true })
  })
  await expect(sessionCache).toContainText('1 search is cached in memory')
  await sessionCache.getByRole('button', { name: 'Clear session search cache' }).click()
  await page.getByRole('dialog', { name: 'Clear the session search cache?' })
    .getByRole('button', { name: 'Clear cache' })
    .click()

  expect(await page.evaluate(() => ({
    cached: document.querySelector('#app').__vue_app__.config.globalProperties.$store
      .getters.getSessionSearchHistory.length,
    saved: document.querySelector('#app').__vue_app__.config.globalProperties.$store
      .getters.getSearchHistoryEntries.length
  }))).toEqual({ cached: 0, saved: 1 })

  const searchHistory = storage.locator('.storageItem').filter({
    has: page.getByRole('heading', { name: 'Search history', exact: true })
  })
  await searchHistory.getByRole('button', { name: 'Delete search history' }).click()
  await page.getByRole('dialog', { name: 'Delete all saved search history?' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect.poll(() => page.evaluate(
    () => document.querySelector('#app').__vue_app__.config.globalProperties.$store
      .getters.getSearchHistoryEntries.length
  )).toBe(0)
})

test('shows the page before asynchronous size calculation finishes', async ({ app, page }) => {
  await app.electronApp.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async () => {
      await new Promise(resolve => setTimeout(resolve, 400))
      return {
        downloadRecords: 0,
        videoMetadata: 0,
        subscriptionCache: 0,
        searchHistory: 0,
        history: 0,
        watchStats: 0,
        playlists: 0,
        profiles: 0,
        settings: 0,
        tabSessions: 0,
        liveReminders: 0,
        ytDlpPlayback: 0,
        httpCache: 0,
        tabPreviews: 0,
        playerCache: 0,
        browserCacheData: 0,
        browserRuntimeData: 0,
        otherProfileData: 0,
        profileTotal: 0
      }
    })
  }, IpcChannels.STORAGE_GET_USAGE)

  const storage = await goToSettingsSection(page, 'storage')
  const breakdown = storage.locator('.storageBreakdown')
  await expect(breakdown.locator('.storageDonutCenter')).toContainText('Calculating…')
  await expect(breakdown.locator('.storageDonutCenter')).toContainText('0 B')
  await expect(breakdown.locator('li')).toHaveCount(0)
  await expect(breakdown.locator('.storageDonutSegment')).toHaveCount(0)
  for (const buttonName of [
    'Clear subscription and feed cache',
    'Clear session search cache',
    'Clear HTTP cache',
    'Clear tab image cache',
    'Clear playback caches',
    'Clear Video Metadata Cache'
  ]) {
    await expect(storage.getByRole('button', { name: buttonName, exact: true })).toBeDisabled()
  }
})

test('isolates browser session data with the test profile', async ({ app }) => {
  const paths = await app.electronApp.evaluate(({ app: electronApp }) => ({
    userData: electronApp.getPath('userData'),
    sessionData: electronApp.getPath('sessionData')
  }))

  expect(paths).toEqual({
    userData: app.userDataDir,
    sessionData: app.userDataDir
  })
})

test('accounts for every file in the profile total', async ({ page }) => {
  const usage = await page.evaluate(() => window.ftElectron.storage.getUsage())
  const categorizedTotal = Object.entries(usage).reduce((total, [key, size]) => (
    ['otherProfileData', 'profileTotal'].includes(key) ? total : total + size
  ), 0)

  expect(usage.otherProfileData).toBeGreaterThanOrEqual(0)
  expect(categorizedTotal + usage.otherProfileData).toBe(usage.profileTotal)
})

test('separates Chromium cache and runtime files from the catch-all', async ({ app, page }) => {
  const mebibyte = 1024 * 1024
  const files = [
    ['Code Cache/js/storage-test.bin', 2 * mebibyte],
    ['GPUCache/storage-test.bin', mebibyte],
    ['Session Storage/storage-test.bin', 3 * mebibyte],
    ['Local Storage/leveldb/storage-test.bin', 4 * mebibyte],
    ['Dictionaries/storage-test.bin', 5 * mebibyte],
    ['Crashpad/reports/storage-test.dmp', 6 * mebibyte]
  ]

  await Promise.all(files.map(async ([relativePath, size]) => {
    const filePath = path.join(app.userDataDir, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, Buffer.alloc(size))
  }))

  const usage = await page.evaluate(() => window.ftElectron.storage.getUsage())
  expect(usage.browserCacheData).toBeGreaterThanOrEqual(8 * mebibyte)
  expect(usage.browserRuntimeData).toBeGreaterThanOrEqual(13 * mebibyte)

  const categorizedTotal = Object.entries(usage).reduce((total, [key, size]) => (
    ['otherProfileData', 'profileTotal'].includes(key) ? total : total + size
  ), 0)
  expect(categorizedTotal + usage.otherProfileData).toBe(usage.profileTotal)
})

test('clears bounded disk caches without touching user data', async ({ app, page }) => {
  // Parallel Xvfb workers share window focus. This test covers cleanup, not the IPC focus guard.
  await app.electronApp.evaluate(({ webContents }) => {
    for (const contents of webContents.getAllWebContents()) {
      Object.defineProperty(contents, 'isFocused', { value: () => true })
    }
  })
  const playerCacheDirectory = path.join(app.userDataDir, 'player_cache')
  const playerCacheFile = path.join(playerCacheDirectory, 'player.js')
  const tabCacheDirectory = path.join(app.userDataDir, 'tab-previews')
  const tabCacheFile = path.join(
    tabCacheDirectory,
    '1c2f1f8e-4c9c-4f0e-8f1a-2b3c4d5e6f70.jpg'
  )
  await Promise.all([
    mkdir(playerCacheDirectory, { recursive: true }),
    mkdir(tabCacheDirectory, { recursive: true })
  ])
  await Promise.all([
    writeFile(playerCacheFile, Buffer.alloc(2 * 1024 * 1024)),
    writeFile(tabCacheFile, Buffer.alloc(1024 * 1024))
  ])

  const storage = await goToSettingsSection(page, 'storage')
  const tabCache = storage.locator('.storageItem').filter({
    has: page.getByRole('heading', { name: 'Tab thumbnails and channel avatars', exact: true })
  })
  const playbackCaches = storage.locator('.storageItem').filter({
    has: page.getByRole('heading', { name: 'Playback caches', exact: true })
  })
  await expect(tabCache.locator('.storageSize')).toHaveText('1 MiB')
  await expect(playbackCaches.locator('.storageSize')).toHaveText('2 MiB')

  await playbackCaches.getByRole('button', { name: 'Clear playback caches' }).click()
  await page.bringToFront()
  await page.getByRole('dialog', { name: 'Clear the yt-dlp and player caches?' })
    .getByRole('button', { name: 'Clear cache' })
    .click()
  await expect.poll(() => access(playerCacheFile).then(() => true, () => false)).toBe(false)
  await expect(playbackCaches.locator('.storageSize')).toHaveText('0 B')
  await expect(playbackCaches.getByRole('button', { name: 'Clear playback caches' }))
    .toBeDisabled()

  await tabCache.getByRole('button', { name: 'Clear tab image cache' }).click()
  await page.bringToFront()
  await page.getByRole('dialog', { name: 'Clear tab thumbnails and channel avatars?' })
    .getByRole('button', { name: 'Clear cache' })
    .click()
  await expect.poll(() => access(tabCacheFile).then(() => true, () => false)).toBe(false)

  // Active tabs may immediately recreate their thumbnails after cleanup.
  await expect(tabCache.locator('.storageSize')).not.toHaveText('1 MiB')
  expect(await page.evaluate(() => (
    document.querySelector('#app').__vue_app__.config.globalProperties.$store
      .getters.getSearchHistoryEntries.length
  ))).toBe(1)
})

test('uses a third column when the settings window is maximized', async ({
  app,
  attachScreenshot,
  page
}) => {
  await setWindowSize(app, page, { width: 1800, height: 1000 })
  const storage = await goToSettingsSection(page, 'storage')
  await page.getByRole('button', { name: 'Maximize' }).click()

  const cacheGrid = storage.getByRole('heading', { name: 'Replaceable caches' }).locator('..')
  await expect(cacheGrid).toHaveCSS(
    'grid-template-columns',
    /\d+(\.\d+)?px \d+(\.\d+)?px \d+(\.\d+)?px/
  )
  expect(await page.locator('.settingsContent').evaluate(
    element => element.scrollWidth <= element.clientWidth + 1
  )).toBe(true)
  await attachScreenshot('maximized storage settings grid')
})

test.describe('compact storage settings', () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'dark',
        currentLocale: 'en-US',
        uiScale: 95
      }
    }
  })

  test('fits a narrow settings window without horizontal scrolling', async ({ app, attachScreenshot, page }) => {
    await setWindowSize(app, page, { width: 620, height: 720 })
    const storage = await goToSettingsSection(page, 'storage')
    const content = page.locator('.settingsContent')
    const cacheGrid = storage.getByRole('heading', { name: 'Replaceable caches' }).locator('..')

    await expect(storage.locator('.storageBreakdown')).toHaveCSS(
      'grid-template-columns',
      /\d+(\.\d+)?px \d+(\.\d+)?px/
    )
    await expect(cacheGrid).toHaveCSS('grid-template-columns', /^\d+(\.\d+)?px$/)
    expect(await content.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await attachScreenshot('compact dark storage settings')
  })
})
