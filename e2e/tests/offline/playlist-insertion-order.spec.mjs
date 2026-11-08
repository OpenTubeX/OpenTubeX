import { test, expect, goTo, goToSettingsSection, openPlaylistMenuItem } from '../../helpers/app.mjs'

const playlistId = 'insertion-order'
const label = 'Add new videos to the top (custom order)'
const video = (videoId, title) => ({ videoId, title, playlistItemId: videoId, type: 'video', author: 'Test channel', lengthSeconds: 60 })

test.use({
  seed: {
    settings: { currentLocale: 'en-US', userPlaylistSortOrder: 'custom', playlistViewType: 'list' },
    playlists: [{
      _id: playlistId,
      playlistName: 'Weekend watching',
      description: 'Videos saved for the weekend',
      protected: false,
      videos: [video('aaaaaaaaaaa', 'First saved video'), video('bbbbbbbbbbb', 'Second saved video')],
    }, { _id: 'watchLater', playlistName: 'Watch Later', videos: [] }],
  },
})

async function openPlaylist(page) {
  await goTo(page, 'userplaylists')
  await page.getByRole('link', { name: 'Weekend watching', exact: true }).click()
  await expect(page.locator('.playlistTitle')).toHaveText('Weekend watching')
}

async function add(page, action, videos, _id = playlistId) {
  await page.evaluate(({ action, videos, _id }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.dispatch(action, action === 'addVideo' ? { _id, videoData: videos[0] } : { _id, videos })
  }, { action, videos, _id })
}

async function videoIds(page, id = playlistId) {
  return page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .getters.getPlaylist(id).videos.map(video => video.videoId), id)
}

test('saves a per-playlist top insertion preference across restarts, preserves batch order, and can return to bottom insertion', async ({ app, page, attachScreenshot }, testInfo) => {
  test.setTimeout(120_000)
  await openPlaylist(page)
  await page.getByTitle('Edit Playlist Info', { exact: true }).click()
  const toggle = page.getByRole('checkbox', { name: label, exact: true })
  await expect(toggle).not.toBeChecked()
  await page.getByText(label, { exact: true }).click()
  await expect(toggle).toBeChecked()
  await toggle.press('Space')
  await expect(toggle).not.toBeChecked()
  await page.getByText(label, { exact: true }).click()
  await page.locator('.playlistOptions').getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByTitle('Edit Playlist Info', { exact: true }).click()
  await expect(toggle).not.toBeChecked()
  await page.getByText(label, { exact: true }).click()
  await attachScreenshot('playlist-top-insertion-setting')
  const bounds = await page.locator('.playlistInfo').boundingBox()
  expect(bounds, 'Playlist editor must be visible before taking its screenshot').not.toBeNull()
  await page.screenshot({
    path: testInfo.outputPath('playlist-insertion-setting.png'),
    animations: 'disabled',
    clip: { x: bounds.x, y: bounds.y, width: bounds.width, height: 200 },
  })
  await page.getByRole('button', { name: 'Save Changes' }).click()
  expect(await videoIds(page)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb'])

  await add(page, 'addVideo', [video('ccccccccccc', 'Newly saved video')])
  await add(page, 'addVideos', [video('ddddddddddd', 'First copied video'), video('eeeeeeeeeee', 'Second copied video')])
  await expect(page.locator('.playlistItems .h3Title').filter({ visible: true })).toHaveText(['First copied video', 'Second copied video', 'Newly saved video', 'First saved video', 'Second saved video'])
  await add(page, 'addVideo', [video('ccccccccccc', 'Newly saved video')])
  expect(await videoIds(page)).toEqual(['ddddddddddd', 'eeeeeeeeeee', 'ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb'])

  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .dispatch('updateUserPlaylistSortOrder', 'video_title_ascending'))
  await expect(page.locator('.playlistItems .h3Title').filter({ visible: true })).toHaveText(['First copied video', 'First saved video', 'Newly saved video', 'Second copied video', 'Second saved video'])
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .dispatch('updateUserPlaylistSortOrder', 'custom'))

  // Built-in playlists retain their own default independently.
  await add(page, 'addVideo', [video('fffffffffff', 'Watch later first')], 'watchLater')
  await add(page, 'addVideo', [video('ggggggggggg', 'Watch later second')], 'watchLater')
  expect(await videoIds(page, 'watchLater')).toEqual(['fffffffffff', 'ggggggggggg'])

  const relaunched = await app.relaunch()
  page = relaunched.page
  await openPlaylist(page)
  await expect(page.locator('.playlistItems .h3Title').filter({ visible: true })).toHaveText(['First copied video', 'Second copied video', 'Newly saved video', 'First saved video', 'Second saved video'])
  await page.getByTitle('Edit Playlist Info', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeChecked()
  await page.getByText(label, { exact: true }).click()
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await add(page, 'addVideo', [video('hhhhhhhhhhh', 'Appended video')])
  expect(await videoIds(page)).toEqual(['ddddddddddd', 'eeeeeeeeeee', 'ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb', 'hhhhhhhhhhh'])
})

test('keeps the insertion setting readable at narrow widths and enlarged UI scales', async ({ app, page, attachScreenshot }) => {
  await openPlaylist(page)
  await page.getByTitle('Edit Playlist Info', { exact: true }).click()
  for (const [width, height, scale, colorScheme] of [[1200, 900, 1.25, 'dark'], [375, 812, 1, 'light'], [812, 375, 1, 'dark']]) {
    await app.electronApp.evaluate(({ BrowserWindow }, { width, height, scale }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setSize(width, height)
      window.webContents.setZoomFactor(scale)
    }, { width, height, scale })
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const toggle = page.getByRole('checkbox', { name: label, exact: true })
    await toggle.scrollIntoViewIfNeeded()
    const text = page.locator('.switch-label-text', { hasText: label })
    await expect(text).toBeVisible()
    const bounds = await text.boundingBox()
    expect(bounds, 'Insertion setting must be visible before measuring its bounds').not.toBeNull()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
    await page.getByText(label, { exact: true }).click()
    await expect(toggle).toBeChecked()
    await page.getByText(label, { exact: true }).click()
    await attachScreenshot(`playlist-insertion-${width}-${scale}-${colorScheme}`)
  }
})

test('source refresh prepends missing videos in source order without adding duplicates', async ({ page }) => {
  await page.route(/\/api\/v1\/playlists\/source-order\?/, route => route.fulfill({
    json: {
      title: 'Source playlist',
      description: '',
      playlistId: 'source-order',
      author: 'Test channel',
      authorId: 'UCsource',
      authorThumbnails: [],
      videoCount: 4,
      viewCount: 1,
      updated: 1700000000,
      videos: [video('aaaaaaaaaaa', 'First saved video'), video('ccccccccccc', 'First new video'), video('ddddddddddd', 'Second new video'), video('ccccccccccc', 'First new video')]
        .map((video, index) => ({ ...video, index, authorId: 'UCsource', videoThumbnails: [] })),
    },
  }))
  await openPlaylist(page)
  await page.evaluate(async id => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateBackendPreference', 'invidious')
    await store.dispatch('updateBackendFallback', false)
    await store.dispatch('updateDefaultInvidiousInstance', 'https://invidious.test')
    await store.dispatch('updatePlaylist', { _id: id, sourcePlaylistId: 'source-order' })
  }, playlistId)
  await page.getByTitle('Edit Playlist Info', { exact: true }).click()
  await page.getByText(label, { exact: true }).click()
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await (await openPlaylistMenuItem(page, 'Add missing videos from source playlist')).click()
  await expect.poll(() => videoIds(page)).toEqual(['ccccccccccc', 'ddddddddddd', 'aaaaaaaaaaa', 'bbbbbbbbbbb'])
  const refresh = await openPlaylistMenuItem(page, 'Add missing videos from source playlist')
  await expect(refresh).toBeEnabled()
  await refresh.click()
  await expect(await openPlaylistMenuItem(page, 'Add missing videos from source playlist')).toBeEnabled()
  await page.keyboard.press('Escape')
  expect(await videoIds(page)).toEqual(['ccccccccccc', 'ddddddddddd', 'aaaaaaaaaaa', 'bbbbbbbbbbb'])
})

test('simultaneous additions all persist across restart', async ({ app, page }) => {
  await openPlaylist(page)
  const saved = await page.evaluate(async id => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updatePlaylist', { _id: id, addVideosToTop: true })
    return Promise.all(Array.from({ length: 12 }, (_, index) => store.dispatch('addVideo', {
      _id: id,
      videoData: { videoId: `concurrent${index}`, title: `Concurrent video ${index}`, author: 'Test channel', lengthSeconds: 60 },
    })))
  }, playlistId)
  expect(saved).toEqual(Array(12).fill(true))
  const ids = await videoIds(page)
  expect(ids).toHaveLength(14)
  expect(new Set(ids).size).toBe(14)
  ;({ page } = await app.relaunch())
  await openPlaylist(page)
  expect(await videoIds(page)).toEqual(ids)
})

test('bulk save reports a playlist removed during the write without announcing success', async ({ page }) => {
  await goTo(page, 'userplaylists')
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('showAddToPlaylistPromptForManyVideos', {
      videos: [{ videoId: 'ccccccccccc', title: 'First new video', lengthSeconds: 60 }, { videoId: 'ddddddddddd', title: 'Second new video', lengthSeconds: 60 }],
      newPlaylistDefaultProperties: {},
    })
    const dispatch = store.dispatch.bind(store)
    // Delete after the prompt has selected its target, immediately before the
    // real bulk action reaches IPC. This deterministically models another window.
    store.dispatch = async (action, payload, options) => {
      if (action === 'addVideos') {
        store.dispatch = dispatch
        await dispatch('removePlaylist', payload._id)
      }
      return dispatch(action, payload, options)
    }
  })
  const dialog = page.getByRole('dialog')
  await dialog.locator('.ft-playlist-selector', { hasText: 'Weekend watching' }).click()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Weekend watching: There was an issue with updating this playlist.', { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('bulk-save-error.png'), animations: 'disabled' })
  await expect(page.getByText(/Video\(s\) added to|Videos? added to/)).toHaveCount(0)
  await expect(dialog).toBeHidden()
  expect(await page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPlaylist(id), playlistId)).toBeUndefined()
})

test('a playlist removed immediately before Save uses a generic error without exposing its ID', async ({ page }) => {
  await goTo(page, 'userplaylists')
  await page.evaluate(videos => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .dispatch('showAddToPlaylistPromptForManyVideos', {
      videos,
      newPlaylistDefaultProperties: {},
    }), [video('ccccccccccc', 'First new video'), video('ddddddddddd', 'Second new video')])
  const dialog = page.getByRole('dialog')
  await dialog.locator('.ft-playlist-selector', { hasText: 'Weekend watching' }).click()
  await dialog.getByRole('button', { name: 'Save', exact: true }).evaluate((button, id) => {
    // Apply the other window's removal and click in the same task, before the
    // prompt's watcher can prune the now-missing selection.
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('removePlaylist', id)
    button.click()
  }, playlistId)
  await expect(page.getByText('There was an issue with updating this playlist.', { exact: true })).toBeVisible()
  await expect(page.getByText(`${playlistId}: There was an issue with updating this playlist.`, { exact: true })).toHaveCount(0)
  await expect(page.getByText(/Video\(s\) added to|Videos? added to/)).toHaveCount(0)
  await expect(dialog).toBeHidden()
  await page.screenshot({ path: test.info().outputPath('missing-playlist-error.png'), animations: 'disabled' })
})

test('playlist import restores the saved insertion preference for existing and new playlists', async ({ page }) => {
  await openPlaylist(page)
  await page.evaluate(async id => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updatePlaylist', { _id: id, addVideosToTop: true })
    const playlist = store.getters.getPlaylist(id)
    const contents = JSON.stringify(playlist) + '\n' + JSON.stringify({ ...playlist, _id: 'imported-insertion-order', playlistName: 'Imported order' })
    window.showOpenFilePicker = async () => [{ getFile: async () => new File([contents], 'playlists.db', { type: 'application/x-freetube-db' }) }]
    await store.dispatch('updatePlaylist', { _id: id, addVideosToTop: false })
  }, playlistId)
  const section = await goToSettingsSection(page, 'data')
  await section.getByRole('button', { name: /^Import playlists$/i }).click()
  await expect.poll(() => page.evaluate(id => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return [id, 'imported-insertion-order'].map(id => store.getters.getPlaylist(id)?.addVideosToTop)
  }, playlistId)).toEqual([true, true])
  await expect(page.getByText('Unknown data key: addVideosToTop', { exact: true })).toHaveCount(0)
})
