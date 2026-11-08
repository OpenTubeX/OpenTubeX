import { test, expect, goTo } from '../../helpers/app.mjs'
import { waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const lastUpdatedAt = 1_700_000_000_000
const video = (videoId, title, index) => ({
  videoId,
  title,
  author: 'Test channel',
  authorId: 'UC-test-channel-id',
  lengthSeconds: 60,
  timeAdded: lastUpdatedAt + index,
  playlistItemId: `${videoId}-item`,
  type: 'video',
})
const videos = [video('sortorder01', 'Charlie video', 0), video('sortorder02', 'Alpha video', 1), video('sortorder03', 'Bravo video', 2)]
const customTitles = ['Charlie video', 'Alpha video', 'Bravo video']
const ascendingTitles = ['Alpha video', 'Bravo video', 'Charlie video']

test.describe.configure({ timeout: 120_000 })

test.use({
  seed: {
    settings: {
      currentLocale: 'en-US',
      animationSpeed: 0,
      userPlaylistSortOrder: 'custom',
      playlistViewType: 'list',
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
    },
    playlists: [
      { _id: 'sorted', playlistName: 'Sorted mix', description: '', protected: false, lastUpdatedAt, videos },
      {
        _id: 'unsorted',
        playlistName: 'Unsorted mix',
        description: '',
        protected: false,
        videos: videos.map(item => ({ ...item, playlistItemId: `${item.videoId}-other` })),
      },
      { _id: 'watchLater', playlistName: 'Watch Later', videos: [] },
    ],
  },
})

async function openPlaylist(page, name) {
  await goTo(page, 'userplaylists')
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.locator('.playlistInfo .playlistTitle')).toHaveText(name)
}

function titles(page) {
  return page.locator('.playlistItems .h3Title').filter({ visible: true })
}

test('each playlist keeps its own sort order across restarts', async ({ app, page, attachScreenshot }) => {
  await openPlaylist(page, 'Sorted mix')
  await expect(titles(page)).toHaveText(customTitles)
  await page.locator('.sortSelect select').selectOption('video_title_ascending')
  await expect(titles(page)).toHaveText(ascendingTitles)
  await attachScreenshot('playlist-sorted-by-title')

  expect(await page.evaluate(() => {
    const { getters } = window.$store
    const { sortOrder, lastUpdatedAt } = getters.getPlaylist('sorted')
    return { sortOrder, lastUpdatedAt, setting: getters.getUserPlaylistSortOrder }
  })).toEqual({ sortOrder: 'video_title_ascending', lastUpdatedAt, setting: 'custom' })

  await openPlaylist(page, 'Unsorted mix')
  await expect(titles(page)).toHaveText(customTitles)
  await expect(page.locator('.sortSelect select')).toHaveValue('custom')

  // A playlist deleted in another window is not recreated from its sort order.
  await page.evaluate(() => window.$store.dispatch('updatePlaylistSortOrder', { _id: 'deleted', sortOrder: 'custom' }))

  page = (await app.relaunch()).page
  expect(await page.evaluate(() => window.$store.getters.getAllPlaylists.map(playlist => playlist._id))).not.toContain('deleted')
  await openPlaylist(page, 'Sorted mix')
  await expect(page.locator('.sortSelect select')).toHaveValue('video_title_ascending')
  await expect(titles(page)).toHaveText(ascendingTitles)
})

test('the watch page playlist follows the playlist sort order', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openPlaylist(page, 'Sorted mix')
  await page.locator('.sortSelect select').selectOption('video_title_ascending')
  await titles(page).first().click()
  await waitForPlayback(page)

  const panelTitles = page.locator('.watchVideoPlaylist .playlistItem .h3Title')
  await expect(panelTitles).toHaveText(ascendingTitles)
  // Another tab changing the sort order re-sorts the open playlist.
  await page.evaluate(() => window.$store.dispatch('updatePlaylistSortOrder', { _id: 'sorted', sortOrder: 'video_title_descending' }))
  await expect(panelTitles).toHaveText(ascendingTitles.toReversed())
})

test('the watch page uses a sort preference saved during navigation', async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page)
  await openPlaylist(page, 'Sorted mix')
  await page.evaluate(() => {
    const stop = window.$router.beforeResolve(async to => {
      if (!to.path.startsWith('/watch/')) return
      stop()
      // The playlist page has cached its old order, but the preference save
      // finishes before the watch view is mounted.
      await window.$store.dispatch('updatePlaylistSortOrder', { _id: 'sorted', sortOrder: 'video_title_ascending' })
    })
  })
  await titles(page).first().click()
  await waitForPlayback(page)

  await expect(page.locator('.watchVideoPlaylist .playlistItem .h3Title')).toHaveText(ascendingTitles)
  await testInfo.attach('Sorted watch playlist', {
    body: await page.locator('.watchVideoPlaylist').screenshot(),
    contentType: 'image/png',
  })
})
