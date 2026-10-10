import { expect, goToSettingsSection, test } from '../../helpers/app.mjs'
import { zipSync, strToU8 } from 'fflate'
import { DBActions } from '../../../src/constants.js'

test('Takeout playlist imports preserve off-page members and stable identities when repeated', async ({ page }) => {
  const section = await goToSettingsSection(page, 'data')
  const videos = Array.from({ length: 350 }, (_, index) => ({ videoId: `v${String(index).padStart(10, '0')}`, playlistItemId: `saved-${index}`, timeAdded: index }))
  const archive = Array.from(zipSync({
    'Takeout/YouTube/playlists/Retained.csv': strToU8('Video ID,Playlist video creation timestamp\nv0000000340,1970-01-01T00:00:00.340Z\nabcdefghijk,2025-01-01T00:00:00Z\n'),
    'Takeout/YouTube/playlists/New.csv': strToU8('Video ID,Playlist video creation timestamp\nmnopqrstuvw,2025-01-01T00:00:00Z\n'),
  }))
  await page.evaluate(async ({ videos, archive, action }) => {
    await window.ftElectron.dbPlaylists(action, { _id: 'takeout-target', playlistName: 'Retained', videos, protected: true, createdAt: 1, futureMetadata: { keep: true } })
    await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('grabAllPlaylists')
    window.showOpenFilePicker = async () => [{ getFile: async () => new File([Uint8Array.from(archive)], 'takeout-playlists.zip', { type: 'application/zip' }) }]
  }, { videos, archive, action: DBActions.GENERAL.UPSERT })
  let identities
  for (let iteration = 0; iteration < 2; iteration++) {
    await section.getByRole('button', { name: 'Import YouTube Takeout ZIP' }).click()
    const prompt = page.locator('.settingsSubpageContent', { hasText: 'takeout-playlists.zip' })
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: 'Import selected data' }).click()
    await expect(prompt).toBeHidden()
    const retained = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'takeout-target' }))
    expect(retained.videos).toHaveLength(351)
    expect(retained.videos.slice(0, 350)).toEqual(videos)
    expect(retained.protected).toBe(true)
    expect(retained.createdAt).toBe(1)
    expect(retained.futureMetadata).toEqual({ keep: true })
    expect(typeof retained.videos.at(-1).playlistItemId).toBe('string')
    const summaries = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSummaries'))
    const created = summaries.find(playlist => playlist.playlistName === 'New')
    expect(created.videoCount).toBe(1)
    expect(created.protected).toBe(false)
    expect(Number.isFinite(created.createdAt)).toBe(true)
    const current = retained.videos.map(video => video.playlistItemId)
    if (identities) expect(current).toEqual(identities)
    identities = current
  }
  await page.reload()
  await expect.poll(() => page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistSnapshot', { id: 'takeout-target' })).videos.map(video => video.playlistItemId))).toEqual(identities)
})

test('shows icons on data actions and vertically centers export choices', async ({ page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  const actionButtons = dataSection.locator('.ft-flex-box.box > .btn')

  await expect(actionButtons).toHaveCount(14)
  await expect.poll(() => actionButtons.locator(':scope > .ft-icon').count()).toBe(14)

  await dataSection.getByRole('button', { name: /Export Subscriptions/i }).click()
  const exportChoices = page.locator('.settingsSubpageContent .exportTypeButtons')
  await expect(exportChoices).toHaveCSS('align-content', 'center')
  await expect(exportChoices).toHaveCSS('align-items', 'center')
  await expect(exportChoices).toHaveCSS('justify-content', 'space-evenly')
  await expect.poll(() => exportChoices.evaluate(container => {
    const subpage = container.closest('.settingsSubpageContent')
    const buttons = [...container.querySelectorAll('button')]
    if (!subpage || buttons.length === 0) return Number.POSITIVE_INFINITY

    const subpageRect = subpage.getBoundingClientRect()
    const buttonRects = buttons.map(button => button.getBoundingClientRect())
    const buttonsTop = Math.min(...buttonRects.map(rect => rect.top))
    const buttonsBottom = Math.max(...buttonRects.map(rect => rect.bottom))
    const subpageCenter = (subpageRect.top + subpageRect.bottom) / 2
    const buttonsCenter = (buttonsTop + buttonsBottom) / 2
    return Math.abs(subpageCenter - buttonsCenter)
  })).toBeLessThanOrEqual(1)
  await expect.poll(() => exportChoices.getByRole('button').evaluateAll(buttons => (
    buttons.length > 0 && buttons.every(button => button.querySelector('.ft-icon'))
  ))).toBe(true)
})

test('exports and imports search history and merges changed history IDs through the unified ZIP', async ({ page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  await page.evaluate(async action => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateSearchHistoryEntry', { _id: 'backup-query', query: 'backup query', lastUpdatedAt: Date.now() })
    await store.dispatch('recordWatchTime', { date: '2026-09-26', seconds: 42 })
    await window.ftElectron.dbHistory(action, { _id: 'backup-history', videoId: 'zipmerge001', timeWatched: 10, watchProgress: 80, isWatched: true, backupUnknown: 'keep' })
    window.backupArchive = null
    window.backupChunks = []
    window.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async data => { window.backupChunks.push(data) },
        close: async () => { window.backupArchive = new Blob(window.backupChunks, { type: 'application/zip' }) },
        abort: async () => {},
      }),
    })
  }, DBActions.GENERAL.UPSERT)

  await dataSection.getByRole('button', { name: 'Export backup' }).click()
  await expect.poll(() => page.evaluate(() => window.backupArchive?.size ?? 0)).toBeGreaterThan(0)

  await page.evaluate(async actions => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('removeSearchHistoryEntry', 'backup-query')
    await store.dispatch('clearWatchStats')
    await window.ftElectron.dbHistory(actions.DELETE, 'zipmerge001')
    await window.ftElectron.dbHistory(actions.UPSERT, { _id: 'current-history', videoId: 'zipmerge001', timeWatched: 20, watchProgress: 30, isWatched: false, currentUnknown: 'keep' })
    window.showOpenFilePicker = async () => [{
      getFile: async () => new File([window.backupArchive], 'opentubex-backup.zip', { type: 'application/zip' }),
    }]
  }, DBActions.GENERAL)
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getSearchHistoryEntries.some(entry => entry.query === 'backup query')
  })).toBe(true)
  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getWatchSecondsByDate['2026-09-26']
  })).toBe(42)
  await expect(page.locator('.toast', { hasText: 'Backup imported successfully' })).toBeVisible()
  expect(await page.evaluate(async () => (await window.ftElectron.libraryQuery('videoState', { ids: ['zipmerge001'] })).history)).toEqual([
    { _id: 'current-history', videoId: 'zipmerge001', timeWatched: 20, watchProgress: 80, isWatched: true, backupUnknown: 'keep', currentUnknown: 'keep' },
  ])
})

test('opens the profile directory in the file manager', async ({ app }) => {
  const { electronApp, page, userDataDir } = app
  await electronApp.evaluate(({ shell }) => {
    globalThis.openedProfileDirectory = null
    shell.openPath = async (directory) => {
      globalThis.openedProfileDirectory = directory
      return ''
    }
  })

  const storageSection = await goToSettingsSection(page, 'storage')
  await storageSection.getByRole('button', { name: /Open Profile Directory/i }).click()

  await expect.poll(() => electronApp.evaluate(() => globalThis.openedProfileDirectory))
    .toBe(userDataDir)
})

test('does not show a delayed IPC error after opening the profile directory', async ({ app }) => {
  const { electronApp, page, userDataDir } = app
  await electronApp.evaluate(({ shell }) => {
    globalThis.openedProfileDirectory = null
    globalThis.profileDirectoryOpenSettled = false
    shell.openPath = async (directory) => {
      globalThis.openedProfileDirectory = directory
      await new Promise(resolve => setTimeout(resolve, 50))
      globalThis.profileDirectoryOpenSettled = true
      throw new Error('reply was never sent')
    }
  })

  const storageSection = await goToSettingsSection(page, 'storage')
  await page.evaluate(() => {
    globalThis.profileDirectoryErrorToastShown = false
    const observer = new MutationObserver(() => {
      if (document.body.textContent.includes('Unable to open profile directory')) {
        globalThis.profileDirectoryErrorToastShown = true
        observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
  await storageSection.getByRole('button', { name: /Open Profile Directory/i }).click()

  await expect.poll(() => electronApp.evaluate(() => globalThis.openedProfileDirectory))
    .toBe(userDataDir)
  await expect.poll(() => electronApp.evaluate(() => globalThis.profileDirectoryOpenSettled))
    .toBe(true)
  await page.waitForTimeout(2500)
  expect(await page.evaluate(() => globalThis.profileDirectoryErrorToastShown)).toBe(false)
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getHistoryCacheById.member00001?.isMembersOnly
  })).toBe(true)
})
