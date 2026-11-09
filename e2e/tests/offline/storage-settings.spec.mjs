import { DBActions, IpcChannels } from '../../../src/constants.js'
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
  await expect(page.locator('.settingsWindow [data-settings-tab="data"]'))
    .toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.settingsWindow [data-settings-tab="data"] [data-icon="layer-group"]'))
    .toBeVisible()
  await expect(page.locator('.settingsWindow [data-settings-tab="storage"] [data-icon="database"]'))
    .toBeVisible()
  await expect(dataAndStorage.locator('.storageBreakdown')).toHaveCount(0)

  const settingsContent = page.locator('.settingsContent')
  await settingsContent.evaluate(element => { element.scrollTop = 100 })
  const storageTab = page.locator('.settingsWindow [data-settings-tab="storage"]')
  await page.locator('.settingsWindow [data-settings-tab="data"]').focus()
  await page.keyboard.press('ArrowRight')
  await expect(storageTab).toBeFocused()
  await expect(storageTab).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => settingsContent.evaluate(element => element.scrollTop)).toBe(0)
  await expect.poll(() => app.electronApp.evaluate(
    () => globalThis.__storageUsageReadCount
  )).toBe(1)

  // Returning from the profile manager remounts the section, which must keep
  // its tabs and the selected tab.
  await page.locator('.settingsWindow [data-settings-tab="data"]').click()
  await dataAndStorage.getByRole('button', { name: 'Manage Subscriptions', exact: true }).click()
  await expect(page.locator('.settingsBreadcrumb')).toContainText('Profile Manager')
  await page.locator('.settingsWindow .settingsBackButton').click()
  await expect(dataAndStorage).toBeVisible()
  await expect(storageTab).toBeVisible()
  await expect(page.locator('.settingsWindow [data-settings-tab="data"]'))
    .toHaveAttribute('aria-selected', 'true')
})

test('keeps unavailable storage categories visible and marks the total as partial', async ({ app, page }) => {
  await app.electronApp.evaluate(({ ipcMain }, channels) => {
    ipcMain.removeHandler(channels.STORAGE_GET_USAGE)
    ipcMain.handle(channels.STORAGE_GET_USAGE, () => ({
      tabPreviews: 1024,
      profileTotal: 1024
    }))
    ipcMain.removeHandler(channels.YT_DLP_LIST_DOWNLOADS)
    ipcMain.handle(channels.YT_DLP_LIST_DOWNLOADS, () => [])
  }, IpcChannels)

  const storage = await goToSettingsSection(page, 'storage')
  const breakdown = storage.locator('.storageBreakdown')
  await expect(breakdown.locator('.storageTotal')).toContainText('At least 1 KiB')
  await expect(breakdown.locator('li')).toHaveText([
    'Application cachesAt least 1 KiB100%',
    'Browser cachesExact size unavailable',
    'Stored app dataExact size unavailable',
    'Browser runtime dataExact size unavailable',
    'Other profile filesExact size unavailable'
  ])
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
  const playbackCaches = storage.locator('.storageItem').filter({
    has: page.getByRole('heading', { name: 'Playback caches', exact: true })
  })
  await expect(playbackCaches).toContainText(
    'The URL cache applies only to streams fetched with yt-dlp.'
  )
  const playbackCacheSize = storage.getByRole('slider', {
    name: /yt-dlp stream URL cache limit/
  })
  const playbackCacheTooltip = 'Sets the maximum size of each cached yt-dlp stream entry. Set it to 0 MB to disable persistent caching for yt-dlp streams.'
  await playbackCaches.getByRole('button', { name: playbackCacheTooltip }).focus()
  await expect(page.getByRole('tooltip')).toHaveText(playbackCacheTooltip)
  await expect(playbackCacheSize).toHaveValue('5')
  await playbackCacheSize.fill('4')
  await expect.poll(() => page.evaluate(() => (
    window.$store
      .getters.getYtDlpPlaybackCacheMaxEntrySize
  ))).toBe(4)
  await playbackCacheSize.fill('0')
  await expect.poll(() => page.evaluate(() => (
    window.$store
      .getters.getYtDlpPlaybackCacheMaxEntrySize
  ))).toBe(0)
  await playbackCacheSize.fill('5')
  await expect.poll(() => page.evaluate(() => (
    window.$store
      .getters.getYtDlpPlaybackCacheMaxEntrySize
  ))).toBe(5)
  await expect(storage.getByLabel('Automatic History Retention (Days)')).toHaveValue('30')
  await expect(storage.getByRole('checkbox', { name: 'Replace HTTP Cache' })).toHaveCount(0)
  await expect(storage.locator('.storageLocation').filter({ hasText: 'downloads.json' })
    .locator('[data-icon="file-lines"]')).toBeVisible()
  await expect(storage.locator('.storageLocation').filter({ hasText: 'subscription-cache.sqlite' })
    .locator('[data-icon="file-lines"]')).toBeVisible()
  await expect(storage.locator('.storageLocation').filter({ hasText: 'tab-previews/' })
    .locator('[data-icon="folder-open"]')).toBeVisible()
  await expect(storage.getByText('Measured profile data')).toHaveCount(0)
  await expect(storage.getByRole('button', { name: 'Refresh sizes' })).toHaveCount(0)
  const breakdown = storage.locator('.storageBreakdown')
  await expect(storage.getByRole('heading', { name: 'Storage breakdown' })).toHaveCount(0)
  await expect(breakdown).toHaveAttribute('aria-label', /Storage breakdown/)
  await expect(breakdown.locator('.storageTotal')).toContainText('95 MiB')
  await expect(breakdown.locator('li')).toHaveText([
    'Tracked downloaded media20 MiB21.1%',
    'Application caches10 MiB10.5%',
    'Browser caches15 MiB15.8%',
    'Stored app data35 MiB36.8%',
    'Browser runtime data5 MiB5.3%',
    'Other profile files10 MiB10.5%'
  ])
  await expect(breakdown.locator('.storageBarSegment')).toHaveCount(6)
  await attachScreenshot('storage settings overview')

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
  await page.evaluate(async () => {
    const store = window.$store
    store.commit('addToSessionSearchHistory', {
      query: 'temporary search',
      data: [{ videoId: 'aaaaaaaaaaa' }]
    })
    await store.dispatch('updateSearchHistoryEntry', { _id: 'recent search', query: 'recent search', lastUpdatedAt: Date.now() })
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
    cached: window.$store
      .getters.getSessionSearchHistory.length,
    saved: window.$store
      .getters.getSearchHistoryEntries.length
  }))).toEqual({ cached: 0, saved: 2 })
  await expect(storage.locator('.storageSettings')).toHaveAttribute('aria-busy', 'false')

  const searchHistory = storage.locator('.storageItem').filter({
    has: page.getByRole('heading', { name: 'Search history', exact: true })
  })
  // Retention removes only the searches last used before its cutoff, in the saved list and its datastore.
  const retention = searchHistory.getByRole('spinbutton', { name: 'Automatic Search History Retention (Days)', exact: true })
  await retention.fill('3')
  await retention.press('Enter')
  await expect(page.locator('.toast', { hasText: 'History retention has been saved' })).toBeVisible()
  expect(await page.evaluate(async action => ({
    setting: window.$store.getters.getSearchHistoryRetentionDays,
    saved: window.$store.getters.getSearchHistoryEntries.map(entry => entry._id),
    stored: (await window.ftElectron.dbSearchHistory(action)).map(entry => entry._id)
  }), DBActions.GENERAL.FIND)).toEqual({ setting: '3', saved: ['recent search'], stored: ['recent search'] })
  await searchHistory.getByRole('button', { name: 'Delete search history' }).click()
  await page.getByRole('dialog', { name: 'Delete all saved search history?' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect.poll(() => page.evaluate(
    () => window.$store
      .getters.getSearchHistoryEntries.length
  )).toBe(0)
})

test('shows the page before asynchronous size calculation finishes', async ({ app, page }) => {
  await app.electronApp.evaluate(({ ipcMain }, channel) => {
    // Held until the test has seen the page, since navigating there can take longer than any fixed delay.
    const usage = Promise.withResolvers()
    globalThis.__releaseStorageUsage = usage.resolve
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async () => {
      await usage.promise
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
  await expect(breakdown.locator('.storageTotal')).toContainText('Calculating…')
  await app.electronApp.evaluate(() => globalThis.__releaseStorageUsage())
  await expect(breakdown.locator('.storageTotal')).toContainText('0 B')
  await expect(breakdown.locator('li')).toHaveCount(0)
  await expect(breakdown.locator('.storageBarSegment')).toHaveCount(0)
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

test('reports cleanup rejection instead of success', async ({ app, page }) => {
  await app.electronApp.evaluate(({ ipcMain }, channels) => {
    ipcMain.removeHandler(channels.STORAGE_GET_USAGE)
    ipcMain.handle(channels.STORAGE_GET_USAGE, () => ({
      tabPreviews: 1024,
      otherProfileData: 0,
      profileTotal: 1024
    }))
    ipcMain.removeHandler(channels.STORAGE_CLEAR)
    ipcMain.handle(channels.STORAGE_CLEAR, () => false)
  }, IpcChannels)

  const storage = await goToSettingsSection(page, 'storage')
  await storage.getByRole('button', { name: 'Clear tab image cache' }).click()
  await page.getByRole('dialog', { name: 'Clear tab thumbnails and channel avatars?' })
    .getByRole('button', { name: 'Clear cache' })
    .click()

  await expect(page.locator('.toast', { hasText: 'Cleanup failed' })).toBeVisible()
  await expect(page.locator('.toast', { hasText: 'Cleanup complete' })).toHaveCount(0)
})

test('refreshes sizes when database compaction fails', async ({ app, page }) => {
  await app.electronApp.evaluate(({ ipcMain }, channels) => {
    globalThis.__searchHistoryBytes = 1024
    ipcMain.removeHandler(channels.STORAGE_GET_USAGE)
    ipcMain.handle(channels.STORAGE_GET_USAGE, () => ({
      searchHistory: globalThis.__searchHistoryBytes,
      otherProfileData: 0,
      profileTotal: globalThis.__searchHistoryBytes
    }))
    ipcMain.removeHandler(channels.STORAGE_COMPACT_DATABASES)
    ipcMain.handle(channels.STORAGE_COMPACT_DATABASES, () => {
      globalThis.__searchHistoryBytes = 0
      return false
    })
  }, IpcChannels)

  const storage = await goToSettingsSection(page, 'storage')
  const searchHistory = storage.locator('.storageItem').filter({
    has: page.getByRole('heading', { name: 'Search history', exact: true })
  })
  await expect(searchHistory.locator('.storageSize')).toHaveText('1 KiB')
  await searchHistory.getByRole('button', { name: 'Delete search history' }).click()
  await page.getByRole('dialog', { name: 'Delete all saved search history?' })
    .getByRole('button', { name: 'Delete' })
    .click()

  await expect(page.locator('.toast', { hasText: 'Cleanup failed' })).toBeVisible()
  await expect(page.locator('.toast', { hasText: 'Cleanup complete' })).toHaveCount(0)
  await expect(searchHistory.locator('.storageSize')).toHaveText('0 B')
})

test('reports rejected download record cleanup', async ({ app, page }) => {
  await app.electronApp.evaluate(({ ipcMain }, channels) => {
    ipcMain.removeHandler(channels.STORAGE_GET_USAGE)
    ipcMain.handle(channels.STORAGE_GET_USAGE, () => ({
      downloadRecords: 1024,
      otherProfileData: 0,
      profileTotal: 1024
    }))
    ipcMain.removeHandler(channels.YT_DLP_LIST_DOWNLOADS)
    ipcMain.handle(channels.YT_DLP_LIST_DOWNLOADS, () => [{
      id: 'finished-download',
      status: 'completed',
      sizeBytes: 1024
    }])
    ipcMain.removeHandler(channels.YT_DLP_CLEAR_DOWNLOADS)
    ipcMain.handle(channels.YT_DLP_CLEAR_DOWNLOADS, () => false)
  }, IpcChannels)

  const storage = await goToSettingsSection(page, 'storage')
  await storage.getByRole('button', { name: 'Clear download history records' }).click()
  await page.getByRole('dialog', { name: 'Clear all finished download records?' })
    .getByRole('button', { name: 'Clear records' })
    .click()

  await expect(page.locator('.toast', { hasText: 'Cleanup failed' })).toBeVisible()
  await expect(page.locator('.toast', { hasText: 'Cleanup complete' })).toHaveCount(0)
})

test('reports rejected yt-dlp playback cleanup', async ({ app, page }) => {
  await app.electronApp.evaluate(({ ipcMain }, channels) => {
    globalThis.__playerCacheBytes = 1024
    ipcMain.removeHandler(channels.STORAGE_GET_USAGE)
    ipcMain.handle(channels.STORAGE_GET_USAGE, () => ({
      ytDlpPlayback: 1024,
      playerCache: globalThis.__playerCacheBytes,
      otherProfileData: 0,
      profileTotal: 1024 + globalThis.__playerCacheBytes
    }))
    ipcMain.removeHandler(channels.STORAGE_CLEAR)
    ipcMain.handle(channels.STORAGE_CLEAR, () => {
      globalThis.__playerCacheBytes = 0
      return true
    })
    ipcMain.removeHandler(channels.YT_DLP_PLAYBACK_CACHE_CLEAR)
    ipcMain.handle(channels.YT_DLP_PLAYBACK_CACHE_CLEAR, () => false)
  }, IpcChannels)

  const storage = await goToSettingsSection(page, 'storage')
  const playbackCaches = storage.locator('.storageItem').filter({
    has: page.getByRole('heading', { name: 'Playback caches', exact: true })
  })
  await expect(playbackCaches.locator('.storageSize')).toHaveText('2 KiB')
  await playbackCaches.getByRole('button', { name: 'Clear playback caches' }).click()
  await page.getByRole('dialog', { name: 'Clear the yt-dlp and player caches?' })
    .getByRole('button', { name: 'Clear cache' })
    .click()

  await expect(page.locator('.toast', { hasText: 'Cleanup failed' })).toBeVisible()
  await expect(page.locator('.toast', { hasText: 'Cleanup complete' })).toHaveCount(0)
  await expect(playbackCaches.locator('.storageSize')).toHaveText('1 KiB')
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
    window.$store
      .getters.getSearchHistoryEntries.length
  ))).toBe(1)
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
    await goToSettingsSection(page, 'storage')
    const content = page.locator('.settingsContent')
    expect(await content.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await attachScreenshot('compact dark storage settings')
  })
})
