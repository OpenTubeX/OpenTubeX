import { test, expect, goTo } from '../../helpers/app.mjs'

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
  await page.getByTitle('Cancel', { exact: true }).click()
  await page.getByTitle('Edit Playlist Info', { exact: true }).click()
  await expect(toggle).not.toBeChecked()
  await page.getByText(label, { exact: true }).click()
  await attachScreenshot('playlist-top-insertion-setting')
  const bounds = await page.locator('.playlistInfo').boundingBox()
  await page.screenshot({
    path: testInfo.outputPath('playlist-insertion-setting.png'),
    animations: 'disabled',
    clip: { x: bounds.x, y: bounds.y, width: bounds.width, height: 200 },
  })
  await page.getByTitle('Save Changes', { exact: true }).click()
  expect(await videoIds(page)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb'])

  await add(page, 'addVideo', [video('ccccccccccc', 'Newly saved video')])
  await add(page, 'addVideos', [video('ddddddddddd', 'First copied video'), video('eeeeeeeeeee', 'Second copied video')])
  await expect(page.locator('.playlistItems .h3Title:visible')).toHaveText(['First copied video', 'Second copied video', 'Newly saved video', 'First saved video', 'Second saved video'])
  await add(page, 'addVideo', [video('ccccccccccc', 'Newly saved video')])
  expect(await videoIds(page)).toEqual(['ddddddddddd', 'eeeeeeeeeee', 'ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb'])

  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .dispatch('updateUserPlaylistSortOrder', 'video_title_ascending'))
  await expect(page.locator('.playlistItems .h3Title:visible')).toHaveText(['First copied video', 'First saved video', 'Newly saved video', 'Second copied video', 'Second saved video'])
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .dispatch('updateUserPlaylistSortOrder', 'custom'))

  // Built-in playlists retain their own default independently.
  await add(page, 'addVideo', [video('fffffffffff', 'Watch later first')], 'watchLater')
  await add(page, 'addVideo', [video('ggggggggggg', 'Watch later second')], 'watchLater')
  expect(await videoIds(page, 'watchLater')).toEqual(['fffffffffff', 'ggggggggggg'])

  const relaunched = await app.relaunch()
  page = relaunched.page
  await openPlaylist(page)
  await expect(page.locator('.playlistItems .h3Title:visible')).toHaveText(['First copied video', 'Second copied video', 'Newly saved video', 'First saved video', 'Second saved video'])
  await page.getByTitle('Edit Playlist Info', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeChecked()
  await page.getByText(label, { exact: true }).click()
  await page.getByTitle('Save Changes', { exact: true }).click()
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
  await page.getByTitle('Save Changes', { exact: true }).click()
  const refresh = page.getByTitle('Add missing videos from source playlist', { exact: true }).filter({ visible: true })
  await refresh.click()
  await expect.poll(() => videoIds(page)).toEqual(['ccccccccccc', 'ddddddddddd', 'aaaaaaaaaaa', 'bbbbbbbbbbb'])
  await expect(refresh).toBeEnabled()
  await refresh.click()
  await expect(refresh).toBeEnabled()
  expect(await videoIds(page)).toEqual(['ccccccccccc', 'ddddddddddd', 'aaaaaaaaaaa', 'bbbbbbbbbbb'])
})
