import { expect, goToSettingsSection, test } from '../../helpers/app.mjs'
import { readUnifiedBackup } from '../../../src/renderer/helpers/unifiedBackup.js'

test('exports and imports search history through the unified ZIP', async ({ page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateSearchHistoryEntry', { _id: 'backup-query', query: 'backup query', lastUpdatedAt: Date.now() })
    await store.dispatch('recordWatchTime', { date: '2026-09-26', seconds: 42 })
    window.backupArchive = null
    window.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async blob => { window.backupArchive = blob },
        close: async () => {},
      }),
    })
  })

  await dataSection.getByRole('button', { name: 'Export backup' }).click()
  await page.getByRole('button', { name: 'Export selected data' }).click()
  await expect.poll(() => page.evaluate(() => window.backupArchive?.size ?? 0)).toBeGreaterThan(0)

  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('removeSearchHistoryEntry', 'backup-query')
    await store.dispatch('clearWatchStats')
    window.showOpenFilePicker = async () => [{
      getFile: async () => new File([window.backupArchive], 'opentubex-backup.zip', { type: 'application/zip' }),
    }]
  })
  await dataSection.getByRole('button', { name: 'Import backup' }).click()
  const subpage = page.locator('.settingsSubpageContent', { hasText: 'Select the data to import' })
  await expect(subpage.getByText('opentubex-backup.zip')).toBeVisible()
  await expect.poll(() => subpage.locator('.takeoutSelection').evaluate(element => {
    const content = element.closest('.settingsSubpageContent').getBoundingClientRect()
    const selection = element.getBoundingClientRect()
    const offsetX = Math.abs((selection.left + selection.right - content.left - content.right) / 2)
    const offsetY = Math.abs((selection.top + selection.bottom - content.top - content.bottom) / 2)
    return Math.max(offsetX, offsetY)
  })).toBeLessThanOrEqual(1)
  await subpage.getByRole('button', { name: 'Import selected data' }).click()

  await expect.poll(() => page.evaluate(() => {
    const store = window.$store
    return store.getters.getSearchHistoryEntries.some(entry => entry.query === 'backup query')
  })).toBe(true)
  await expect.poll(() => page.evaluate(() => {
    const store = window.$store
    return store.getters.getWatchSecondsByDate['2026-09-26']
  })).toBe(42)
  await expect(page.locator('.toast', { hasText: 'Backup imported successfully' })).toBeVisible()
})

test('exports only selected backup categories and offers only those categories on import', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  const dataSection = await goToSettingsSection(page, 'data')
  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateSearchHistoryEntry', { _id: 'selected-query', query: 'selected backup query', lastUpdatedAt: Date.now() })
    window.backupArchive = null
    window.showSaveFilePicker = async () => {
      if (!navigator.userActivation.isActive) throw new DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError')
      return {
        createWritable: async () => ({
          write: async blob => { window.backupArchive = blob }, close: async () => {},
        })
      }
    }
  })
  await dataSection.getByRole('button', { name: 'Export backup' }).click()
  const choices = page.locator('.settingsSubpageContent')
  const checkboxes = choices.getByRole('checkbox')
  await expect(checkboxes).toHaveCount(6)
  for (const checkbox of await checkboxes.all()) {
    await expect(checkbox).toBeChecked()
    await checkbox.locator('+ label').click()
    await expect(checkbox).not.toBeChecked()
  }
  await expect(choices.getByRole('button', { name: 'Export selected data' })).toBeDisabled()
  await choices.getByText('Search history', { exact: true }).click()
  await choices.getByRole('button', { name: 'Export selected data' }).click()
  await expect.poll(() => page.evaluate(() => window.backupArchive?.size ?? 0)).toBeGreaterThan(0)
  const bytes = await page.evaluate(async () => [...new Uint8Array(await window.backupArchive.arrayBuffer())])
  const { data } = await readUnifiedBackup(new Blob([new Uint8Array(bytes)]))
  expect(Object.keys(data)).toEqual(['searchHistory'])
  expect(data.searchHistory.some(entry => entry.query === 'selected backup query')).toBe(true)

  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('removeSearchHistoryEntry', 'selected-query')
    await store.dispatch('recordWatchTime', { date: '2026-09-26', seconds: 81 })
    window.showOpenFilePicker = async () => [{
      getFile: async () => new File([window.backupArchive], 'selected-backup.zip', { type: 'application/zip' }),
    }]
  })
  await dataSection.getByRole('button', { name: 'Import backup' }).click()
  await expect(choices.getByRole('checkbox')).toHaveCount(1)
  await expect(choices.getByRole('checkbox', { name: 'Search history', exact: true })).toBeChecked()
  await choices.getByRole('button', { name: 'Import selected data' }).click()
  await expect.poll(() => page.evaluate(() => {
    const store = window.$store
    return store.getters.getSearchHistoryEntries.some(entry => entry.query === 'selected backup query') &&
      store.getters.getWatchSecondsByDate['2026-09-26'] === 81
  })).toBe(true)
})

test('keeps backup export choices usable at narrow widths', { tag: '@scale' }, async ({ page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  await dataSection.getByRole('button', { name: 'Export backup' }).click()
  const choices = page.locator('.settingsSubpageContent')
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 800 })
    await expect(choices.getByRole('checkbox')).toHaveCount(6)
    const button = choices.getByRole('button', { name: 'Export selected data' })
    await expect(button).toBeVisible()
    await expect.poll(() => choices.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    const bounds = await button.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
  }
})

test('imports the members-only flag from exported watch history', async ({ page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  await page.evaluate(() => {
    const historyEntry = {
      author: 'Members Channel',
      authorId: 'UCmembersOnlyImport',
      isLive: false,
      isMembersOnly: true,
      lengthSeconds: 120,
      published: Date.now() - 86_400_000,
      timeWatched: Date.now(),
      title: 'Members-only import',
      type: 'video',
      videoId: 'member00001',
      watchProgress: 30
    }
    const contents = `${JSON.stringify(historyEntry)}\n`

    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [{
        getFile: async () => new File(
          [contents],
          'opentubex-history.db',
          { type: 'application/x-freetube-db' }
        )
      }]
    })
  })

  await dataSection.getByRole('button', { name: 'Import history', exact: true }).click()

  await expect(page.locator('.toast', {
    hasText: 'All watched history has been successfully imported'
  })).toBeVisible()
  await expect(page.locator('.toast', { hasText: 'Unknown data key' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const store = window.$store
    return store.getters.getHistoryCacheById.member00001?.isMembersOnly
  })).toBe(true)
})

test.describe('playlist import with duplicate names', () => {
  const playlist = (_id, videoId) => ({
    _id,
    playlistName: 'Music',
    description: _id,
    videos: [{ videoId, title: videoId, lengthSeconds: 60, timeAdded: 1, playlistItemId: videoId }]
  })

  test.use({ seed: { playlists: [playlist('music-a', 'aaaaaaaaaaa'), playlist('music-b', 'bbbbbbbbbbb')] } })

  test('merges into the playlist with the same ID instead of the first namesake', async ({ page }) => {
    const dataSection = await goToSettingsSection(page, 'data')
    const imported = { ...playlist('music-b', 'ccccccccccc'), description: 'Imported description' }
    await page.evaluate((contents) => {
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async () => [{
          getFile: async () => new File([contents], 'opentubex-playlists.db', { type: 'application/x-freetube-db' })
        }]
      })
    }, `${JSON.stringify(imported)}\n`)

    await dataSection.getByRole('button', { name: 'Import playlists', exact: true }).click()

    await expect(page.locator('.toast', { hasText: 'All playlists has been successfully imported' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.$store.getters.getAllPlaylists
      .filter(({ _id }) => _id.startsWith('music-'))
      .map(({ _id, description, videos }) => ({ _id, description, videoIds: videos.map(({ videoId }) => videoId) }))
      .sort((a, b) => a._id.localeCompare(b._id))))
      .toEqual([
        { _id: 'music-a', description: 'music-a', videoIds: ['aaaaaaaaaaa'] },
        { _id: 'music-b', description: 'Imported description', videoIds: ['bbbbbbbbbbb', 'ccccccccccc'] }
      ])
  })
})

test.describe('playlist import into a renamed playlist', () => {
  const playlist = (_id, playlistName, videoId) => ({
    _id,
    playlistName,
    description: _id,
    videos: [{ videoId, title: videoId, lengthSeconds: 60, timeAdded: 1, playlistItemId: videoId }]
  })

  test.use({ seed: { playlists: [playlist('rock', 'Rock', 'aaaaaaaaaaa'), playlist('jazz', 'Jazz', 'bbbbbbbbbbb')] } })

  test('keeps the videos of every record that merges into the same playlist', async ({ page }) => {
    const dataSection = await goToSettingsSection(page, 'data')
    // One record matches `jazz` by ID, the other matches it by name
    const contents = [playlist('jazz', 'Rock', 'ccccccccccc'), playlist('other', 'Jazz', 'ddddddddddd')]
      .map(record => JSON.stringify(record)).join('\n') + '\n'
    await page.evaluate((contents) => {
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async () => [{
          getFile: async () => new File([contents], 'opentubex-playlists.db', { type: 'application/x-freetube-db' })
        }]
      })
    }, contents)

    await dataSection.getByRole('button', { name: 'Import playlists', exact: true }).click()

    await expect(page.locator('.toast', { hasText: 'All playlists has been successfully imported' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.$store.getters.getAllPlaylists
      .filter(({ _id }) => _id === 'rock' || _id === 'jazz')
      .map(({ _id, videos }) => ({ _id, videoIds: videos.map(({ videoId }) => videoId) }))
      .sort((a, b) => a._id.localeCompare(b._id))))
      .toEqual([
        { _id: 'jazz', videoIds: ['bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'] },
        { _id: 'rock', videoIds: ['aaaaaaaaaaa'] }
      ])
  })
})
