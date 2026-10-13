import { expect, goToSettingsSection, openNewWindowFromTabBar, test, waitForAppReady } from '../../helpers/app.mjs'
import { readUnifiedBackup } from '../../../src/renderer/helpers/unifiedBackup.js'
import { zipSync, strToU8 } from 'fflate'
import { DBActions } from '../../../src/constants.js'

test('restores a released null-name profile and saves customization without changing retained fields', async ({ app, page }, testInfo) => {
  const profile = { _id: 'legacy-null-name', name: null, bgColor: '#558B2F', textColor: '#FFFFFF', icon: { type: 'emoji', value: '🌈' }, subscriptions: [], futureMetadata: { keep: true } }
  const archive = Array.from(zipSync(Object.fromEntries(Object.entries({
    manifest: { format: 'opentubex-backup', version: 1 },
    settings: {},
    profiles: [profile],
    playlists: [],
    history: [],
    searchHistory: [],
    watchStats: { records: [], adjustment: null },
  }).map(([name, data]) => [`${name}.json`, strToU8(JSON.stringify(data))]))))
  const section = await goToSettingsSection(page, 'data')
  await page.evaluate(archive => {
    window.showOpenFilePicker = async () => [{ getFile: async () => new File([Uint8Array.from(archive)], 'legacy-profile-backup.zip', { type: 'application/zip' }) }]
  }, archive)
  await section.getByRole('button', { name: 'Import backup', exact: true }).click()
  const prompt = page.locator('.settingsSubpageContent', { hasText: 'legacy-profile-backup.zip' })
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Import selected data' }).click()
  await expect(prompt).toBeHidden()
  const saved = () => page.evaluate(async ({ id, action }) => (await window.ftElectron.dbProfiles(action, {})).find(profile => profile._id === id), { id: profile._id, action: DBActions.GENERAL.FIND })
  await expect.poll(saved).toStrictEqual(profile)
  await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
  const otherWindow = await openNewWindowFromTabBar(app, page)
  await waitForAppReady(otherWindow)
  await page.locator('.topNav .profileTrigger').click()
  await page.locator('.profileSummary').click()
  await page.locator('.profilePanelHeader button').last().click()
  await page.locator('.profileSettingsContent .profileList').getByText('🌈', { exact: true }).click()
  const editor = page.locator('.profileEdit')
  await expect(editor).toBeVisible()
  await expect(editor.locator('.profileName input')).toHaveValue('')
  await editor.getByRole('button', { name: 'Use Initial', exact: true }).click()
  await expect(editor.locator('.profilePreviewIcon [data-icon="circle-user"]')).toBeVisible()
  // Another window can update durable metadata while this editor retains its old form snapshot.
  const concurrent = { ...profile, subscriptions: [{ id: 'concurrent-channel', name: 'Concurrent channel' }], futureMetadata: { keep: true, concurrent: true } }
  await page.evaluate(({ action, profile }) => window.ftElectron.dbProfiles(action, profile), { action: DBActions.GENERAL.UPSERT, profile: concurrent })
  await editor.getByRole('button', { name: 'Update Profile', exact: true }).click()
  await expect(page.locator('.toast', { hasText: 'Your profile name cannot be empty' })).toHaveCount(0)
  const expected = { ...concurrent, icon: { type: 'icon', value: 'circle-user' } }
  await expect.poll(saved).toStrictEqual(expected)
  for (const windowPage of [page, otherWindow]) {
    await expect.poll(() => windowPage.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.profiles.profileList.find(profile => profile._id === id), profile._id)).toStrictEqual(expected)
  }
  const screenshot = testInfo.outputPath('legacy-null-name-profile.png')
  await page.screenshot({ path: screenshot, fullPage: true })
  await testInfo.attach('Legacy null-name profile retains its name and metadata after customization', { path: screenshot, contentType: 'image/png' })
})

test('closing Settings frees staged backup slots and leaves the live library unchanged', async ({ app, page }) => {
  const archive = Array.from(zipSync(Object.fromEntries(Object.entries({
    manifest: { format: 'opentubex-backup', version: 1 },
    settings: {},
    profiles: [],
    playlists: [],
    history: [{ _id: 'unapplied', videoId: 'abcdefghijk', timeWatched: 1, unknown: { keep: true } }],
    searchHistory: [],
    watchStats: { records: [], adjustment: null },
  }).map(([name, data]) => [`${name}.json`, strToU8(JSON.stringify(data))]))))
  const before = await page.evaluate(() => window.ftElectron.libraryQuery('historyPage'))
  await app.electronApp.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('library-query')
    globalThis.canceledSettingsImports = []
    ipcMain.removeHandler('library-query')
    ipcMain.handle('library-query', async (event, request) => {
      const result = await handler(event, request)
      if (request.method === 'importCancel') globalThis.canceledSettingsImports.push(request.data.id)
      return result
    })
  })
  for (let iteration = 0; iteration < 3; iteration++) {
    const section = await goToSettingsSection(page, 'data')
    await page.evaluate(archive => {
      window.showOpenFilePicker = async () => [{ getFile: async () => new File([Uint8Array.from(archive)], 'abandoned-backup.zip', { type: 'application/zip' }) }]
    }, archive)
    await section.getByRole('button', { name: 'Import backup' }).click()
    await expect(page.locator('.settingsSubpageContent').getByText('abandoned-backup.zip', { exact: true })).toBeVisible()
    await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.canceledSettingsImports.length)).toBe(iteration + 1)
    await expect(page.locator('.settingsWindow')).toBeHidden()
  }
  expect(await page.evaluate(() => window.ftElectron.libraryQuery('historyPage'))).toStrictEqual(before)
})

test('reopening Settings keeps backup buttons locked until a committed import finishes refreshing', async ({ page }) => {
  const record = { _id: 'durable-import', videoId: 'abcdefghijk', timeWatched: 10, watchProgress: 25, isWatched: false, unknown: { keep: true } }
  const archive = Array.from(zipSync(Object.fromEntries(Object.entries({
    manifest: { format: 'opentubex-backup', version: 1 },
    settings: {},
    profiles: [],
    playlists: [],
    history: [record],
    searchHistory: [],
    watchStats: { records: [], adjustment: null },
  }).map(([name, data]) => [`${name}.json`, strToU8(JSON.stringify(data))]))))
  const section = await goToSettingsSection(page, 'data')
  await page.evaluate(archive => {
    window.showOpenFilePicker = async () => [{ getFile: async () => new File([Uint8Array.from(archive)], 'pending-backup.zip', { type: 'application/zip' }) }]
  }, archive)
  await section.getByRole('button', { name: 'Import backup' }).click()
  const prompt = page.locator('.settingsSubpageContent', { hasText: 'pending-backup.zip' })
  await expect(prompt).toBeVisible()
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const dispatch = store.dispatch
    const pending = new Promise(resolve => { window.finishBackupRefresh = resolve })
    window.backupRefreshPending = false
    store.dispatch = async (...args) => {
      if (args[0] === 'grabHistory') {
        window.backupRefreshPending = true
        await pending
      }
      return dispatch(...args)
    }
  })
  await prompt.getByRole('button', { name: 'Import selected data' }).click()
  await expect.poll(() => page.evaluate(() => window.backupRefreshPending)).toBe(true)
  expect(await page.evaluate(() => window.ftElectron.libraryQuery('videoState', { ids: ['abcdefghijk'] })).then(state => state.history)).toStrictEqual([record])
  await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.settingsWindow')).toBeHidden()
  const reopened = await goToSettingsSection(page, 'data')
  await expect(reopened.getByRole('button', { name: 'Import backup' })).toBeDisabled()
  await expect(reopened.getByRole('button', { name: 'Export backup' })).toBeDisabled()
  await page.evaluate(() => window.finishBackupRefresh())
  await expect(reopened.getByRole('button', { name: 'Import backup' })).toBeEnabled()
  await expect(reopened.getByRole('button', { name: 'Export backup' })).toBeEnabled()
  await expect(page.locator('.toast', { hasText: 'Backup imported successfully' })).toHaveCount(0)
  expect(await page.evaluate(() => window.ftElectron.libraryQuery('videoState', { ids: ['abcdefghijk'] })).then(state => state.history)).toStrictEqual([record])
})

test('Takeout playlist imports preserve off-page members and stable identities when repeated', async ({ page }) => {
  const section = await goToSettingsSection(page, 'data')
  const videos = Array.from({ length: 350 }, (_, index) => ({ videoId: `v${String(index).padStart(10, '0')}`, playlistItemId: `saved-${index}`, timeAdded: index }))
  const protectedNamesake = { _id: 'protected-namesake', playlistName: 'Retained', videos: [{ videoId: 'protected', playlistItemId: 'kept' }], protected: true, createdAt: 1, futureMetadata: { keep: true } }
  const archive = Array.from(zipSync({
    'Takeout/YouTube/playlists/Retained.csv': strToU8('Video ID,Playlist video creation timestamp\nv0000000340,1970-01-01T00:00:00.340Z\nabcdefghijk,2025-01-01T00:00:00Z\n'),
    'Takeout/YouTube/playlists/New.csv': strToU8('Video ID,Playlist video creation timestamp\nmnopqrstuvw,2025-01-01T00:00:00Z\n'),
  }))
  await page.evaluate(async ({ videos, protectedNamesake, archive, action }) => {
    await window.ftElectron.dbPlaylists(action, { _id: 'takeout-target', playlistName: 'Retained', videos, protected: false, createdAt: 1, futureMetadata: { keep: true } })
    await window.ftElectron.dbPlaylists(action, protectedNamesake)
    await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('grabAllPlaylists')
    window.showOpenFilePicker = async () => [{ getFile: async () => new File([Uint8Array.from(archive)], 'takeout-playlists.zip', { type: 'application/zip' }) }]
  }, { videos, protectedNamesake, archive, action: DBActions.GENERAL.UPSERT })
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
    expect(retained.protected).toBe(false)
    expect(retained.createdAt).toBe(1)
    expect(retained.futureMetadata).toEqual({ keep: true })
    expect(typeof retained.videos.at(-1).playlistItemId).toBe('string')
    expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'protected-namesake' }))).toStrictEqual(protectedNamesake)
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
  await page.getByRole('button', { name: 'Export selected data' }).click()
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
  await page.evaluate(() => {
    window.backupSyncReasons = []
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.subscribeAction(action => {
      if (action.type === 'scheduleSyncServer') window.backupSyncReasons.push(action.payload)
    })
  })
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
  expect(await page.evaluate(() => window.backupSyncReasons.filter(reason => ['profilesOrSubscriptions', 'playlists', 'history', 'watchStats'].includes(reason)))).toStrictEqual(['profilesOrSubscriptions', 'playlists', 'history', 'watchStats'])
  expect(await page.evaluate(async () => (await window.ftElectron.libraryQuery('videoState', { ids: ['zipmerge001'] })).history)).toEqual([
    { _id: 'current-history', videoId: 'zipmerge001', timeWatched: 20, watchProgress: 80, isWatched: true, backupUnknown: 'keep', currentUnknown: 'keep' },
  ])
})

test('exports only selected backup categories and offers only those categories on import', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  const dataSection = await goToSettingsSection(page, 'data')
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateSearchHistoryEntry', { _id: 'selected-query', query: 'selected backup query', lastUpdatedAt: Date.now() })
    window.backupArchive = null
    window.backupChunks = []
    window.showSaveFilePicker = async () => {
      if (!navigator.userActivation.isActive) throw new DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError')
      return {
        createWritable: async () => ({
          write: async data => { window.backupChunks.push(data) },
          close: async () => { window.backupArchive = new Blob(window.backupChunks, { type: 'application/zip' }) },
          abort: async () => {},
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getSearchHistoryEntries.some(entry => entry.query === 'selected backup query') &&
      store.getters.getWatchSecondsByDate['2026-09-26'] === 81
  })).toBe(true)
})

test('keeps backup export choices usable at narrow widths and fractional UI scales', async ({ page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  await dataSection.getByRole('button', { name: 'Export backup' }).click()
  const choices = page.locator('.settingsSubpageContent')
  for (const zoom of [1, 1.25]) {
    await page.evaluate(value => window.ftElectron.setZoomFactor(value), zoom)
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
  }
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

test('reports a failed legacy history import and preserves duplicate records on retry', async ({ app, page }) => {
  const dataSection = await goToSettingsSection(page, 'data')
  const base = {
    author: 'Legacy channel',
    authorId: 'legacy-channel',
    isLive: false,
    lengthSeconds: 120,
    published: 1,
    timeWatched: 2,
    title: 'First occurrence',
    type: 'video',
    videoId: 'duplicate01',
    watchProgress: 30,
    isWatched: false,
    description: '',
    futureMetadata: { keep: true }
  }
  const records = [{ ...base, _id: 'legacy-first' }, { ...base, _id: 'legacy-second', title: 'Second occurrence', timeWatched: 3 }]
  await page.evaluate(records => {
    window.showOpenFilePicker = async () => [{
      getFile: async () => new File(
        [records.map(record => JSON.stringify(record)).join('\n') + '\n'], 'legacy-history.db', { type: 'application/x-freetube-db' }
      )
    }]
  }, records)
  await app.electronApp.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('library-query')
    if (!original) throw new Error('Missing library IPC handler')
    ipcMain.removeHandler('library-query')
    let fail = true
    ipcMain.handle('library-query', (event, request) => {
      if (request.method === 'importApply' && fail) { fail = false; throw new Error('simulated import persistence failure') }
      return original(event, request)
    })
  })
  const importButton = dataSection.getByRole('button', { name: 'Import history', exact: true })
  await importButton.click()
  await expect(page.locator('.toast', { hasText: 'Import failed' })).toBeVisible()
  await expect(page.locator('.toast', { hasText: 'All watched history has been successfully imported' })).toHaveCount(0)
  expect((await page.evaluate(() => window.ftElectron.libraryQuery('videoState', { ids: ['duplicate01'] }))).history).toStrictEqual([])
  await importButton.click()
  await expect(page.locator('.toast', { hasText: 'All watched history has been successfully imported' })).toBeVisible()
  expect(await page.evaluate(async () => (await window.ftElectron.libraryQuery('historyPage', { limit: 100 })).records.filter(record => record.videoId === 'duplicate01'))).toStrictEqual(records.toReversed())
})
