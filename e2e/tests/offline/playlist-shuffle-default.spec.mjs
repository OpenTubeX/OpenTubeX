import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

const playlistId = 'shuffle-default'
const label = 'Shuffle videos by default'
const videos = Array.from({ length: 6 }, (_, index) => ({
  videoId: `shuffle0000${index}`,
  title: `Shuffle video ${index + 1}`,
  author: 'Test channel',
  authorId: 'UC-test-channel-id',
  lengthSeconds: 120,
  timeAdded: Date.now() + index,
  playlistItemId: `shuffle-item-${index}`,
  type: 'video',
}))

const otherPlaylist = {
  _id: 'in-order',
  playlistName: 'Podcasts',
  description: '',
  protected: false,
  videos: videos.map((video, index) => ({ ...video, videoId: `inorder000${index}`, playlistItemId: `in-order-item-${index}` })),
}

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
    playlists: [{
      _id: playlistId,
      playlistName: 'Music mix',
      description: '',
      protected: false,
      // Offline, only a local cover renders the clickable header thumbnail.
      customThumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoaGgAAAMEAYFL09IQAAAAAElFTkSuQmCC',
      videos,
    }, otherPlaylist, { _id: 'watchLater', playlistName: 'Watch Later', videos: [] }],
  },
})

async function openPlaylist(page) {
  await goTo(page, 'userplaylists')
  await page.getByRole('link', { name: 'Music mix', exact: true }).click()
  await expect(page.locator('.playlistInfo .playlistTitle')).toHaveText('Music mix')
}

function storedPlaylist(page) {
  return page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .getters.getPlaylist(id), playlistId)
}

function thumbnailLink(page) {
  return page.locator('.playlistInfo .playlistThumbnail a')
}

async function playFromThumbnail(page, videoId) {
  const link = thumbnailLink(page)
  await expect(link).toHaveAttribute('href', new RegExp(`/watch/${videoId}\\?`))
  await link.locator('img').click()
  await waitForPlayback(page)
  await expect(page.locator('.watchVideoPlaylist .playlistItem')).toHaveCount(videos.length)
  return page.locator('.watchVideoPlaylist').filter({ visible: true }).getByRole('button', { name: 'Shuffle Playlist' })
}

test('a playlist set to shuffle by default starts shuffled from a random video', async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page)
  await openPlaylist(page)

  // Without the setting, playback starts at the first video in order.
  await expect(thumbnailLink(page)).toHaveAttribute('href', new RegExp(`/watch/${videos[0].videoId}\\?`))

  await page.getByTitle('Edit Playlist Info', { exact: true }).click()
  const toggle = page.getByRole('checkbox', { name: label, exact: true })
  await expect(toggle).not.toBeChecked()
  await page.getByText(label, { exact: true }).click()
  await expect(toggle).toBeChecked()
  await attachScreenshot('playlist-shuffle-default-setting')
  // Pin the random start to the last video so the test is deterministic.
  await page.evaluate(() => { Math.random = () => 0.999 })
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect.poll(async () => (await storedPlaylist(page)).shuffleByDefault).toBe(true)

  await page.getByTitle('Edit Playlist Info', { exact: true }).click()
  await expect(toggle).toBeChecked()
  await page.locator('.playlistOptions').getByRole('button', { name: 'Cancel', exact: true }).click()

  // Reopening the page picks the random start when the playlist loads.
  await openPlaylist(page)
  await expect(thumbnailLink(page)).toHaveAttribute('href', new RegExp(`/watch/${videos.at(-1).videoId}\\?`))
  // A removal that can still be undone must not become the random start.
  const lastVideo = page.locator('.ft-list-video').filter({ has: page.getByText(videos.at(-1).title, { exact: true }) })
  await lastVideo.hover()
  await lastVideo.getByTitle('Remove from Playlist').click()
  const undo = page.getByText('Video has been removed. Click here to undo.', { exact: true })
  await expect(undo).toBeVisible()
  // Check within the five-second undo window, before the removal is saved.
  await expect(thumbnailLink(page)).toHaveAttribute('href', new RegExp(`/watch/${videos.at(-2).videoId}\\?`), { timeout: 2000 })
  await undo.click()
  await expect(thumbnailLink(page)).toHaveAttribute('href', new RegExp(`/watch/${videos.at(-1).videoId}\\?`))
  const shuffle = await playFromThumbnail(page, videos.at(-1).videoId)
  await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
  await attachScreenshot('playlist-shuffle-default-watch')

  // Turning shuffle off for this session leaves the saved preference alone.
  await shuffle.click()
  await expect(shuffle).toHaveAttribute('aria-pressed', 'false')
  expect((await storedPlaylist(page)).shuffleByDefault).toBe(true)
})

test('playlist import restores the shuffle by default preference without unknown key warnings', async ({ page }) => {
  await openPlaylist(page)
  await page.evaluate(async id => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updatePlaylist', { _id: id, shuffleByDefault: true })
    const playlist = store.getters.getPlaylist(id)
    const contents = JSON.stringify(playlist) + '\n' + JSON.stringify({ ...playlist, _id: 'imported-shuffle-default', playlistName: 'Imported mix' })
    window.showOpenFilePicker = async () => [{ getFile: async () => new File([contents], 'playlists.db', { type: 'application/x-freetube-db' }) }]
    await store.dispatch('updatePlaylist', { _id: id, shuffleByDefault: false })
  }, playlistId)
  const section = await goToSettingsSection(page, 'data')
  await section.getByRole('button', { name: /^Import playlists$/i }).click()
  await expect.poll(() => page.evaluate(id => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return [id, 'imported-shuffle-default'].map(id => store.getters.getPlaylist(id)?.shuffleByDefault)
  }, playlistId)).toEqual([true, true])
  await expect(page.getByText('Unknown data key: shuffleByDefault', { exact: true })).toHaveCount(0)
})

test('a shuffle by default playlist opened outside its playlist page also starts shuffled', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  await watch.evaluate(async (vm, { id, video }) => {
    await vm.$store.dispatch('updatePlaylist', { _id: id, shuffleByDefault: true })
    // Without a playlist page visit, the watch view loads the playlist itself instead of a cached copy.
    await vm.tabRouter.push({ path: `/watch/${video.videoId}`, query: { playlistId: id, playlistType: 'user', playlistItemId: video.playlistItemId } })
  }, { id: playlistId, video: videos[2] })
  await expect(page.locator('.watchVideoPlaylist .playlistItem')).toHaveCount(videos.length)
  await expect(page.locator('.watchVideoPlaylist').filter({ visible: true }).getByRole('button', { name: 'Shuffle Playlist' }))
    .toHaveAttribute('aria-pressed', 'true')
  await watch.dispose()
})

test('switching the watch view to another user playlist loads it from the library', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  const panel = page.locator('.watchVideoPlaylist').filter({ visible: true })
  // Start from a YouTube playlist with more videos than the user playlists
  await watch.evaluate(async (vm, videos) => {
    vm.$store.commit('setCachedPlaylist', {
      tabId: vm.tabId ?? 'web',
      value: { id: 'PLyoutube', title: 'YouTube mix', channelName: '', channelId: '', totalVideoCount: 100, items: videos, continuationData: null },
    })
    await vm.tabRouter.push({ path: `/watch/${videos[0].videoId}`, query: { playlistId: 'PLyoutube', playlistItemId: videos[0].playlistItemId } })
  }, videos)
  await expect(panel.locator('.playlistTitle')).toHaveText('YouTube mix')
  await expect(panel).toContainText('94 unavailable videos are hidden')
  // Without a playlist page visit there is no cached copy, as when opening a video from History or the command palette.
  for (const playlist of [{ _id: playlistId, playlistName: 'Music mix', videos }, otherPlaylist]) {
    await watch.evaluate(async (vm, playlist) => {
      const video = playlist.videos[0]
      await vm.tabRouter.push({ path: `/watch/${video.videoId}`, query: { playlistId: playlist._id, playlistType: 'user', playlistItemId: video.playlistItemId } })
    }, playlist)
    await expect(panel.locator('.playlistTitle')).toHaveText(playlist.playlistName)
    await expect(panel.locator('.playlistItem')).toHaveCount(playlist.videos.length)
    await expect(panel).not.toContainText('unavailable')
  }
  await expect(page.locator('.toast', { hasText: 'API Error' })).toHaveCount(0)
  await watch.dispose()
})

test('a playlist default does not carry shuffle over to the next playlist', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  const panel = page.locator('.watchVideoPlaylist').filter({ visible: true })
  const shuffle = panel.getByRole('button', { name: 'Shuffle Playlist' })
  const seeded = { _id: playlistId, playlistName: 'Music mix', videos }
  // The watch view keeps its playlist panel when another playlist opens from its page.
  const switchTo = async (playlist) => {
    await watch.evaluate(async (vm, playlist) => {
      vm.$store.commit('setCachedPlaylist', {
        tabId: vm.tabId ?? 'web',
        value: { id: playlist._id, title: playlist.playlistName, channelName: '', channelId: '', totalVideoCount: playlist.videos.length, items: playlist.videos, continuationData: null },
      })
      const video = playlist.videos[0]
      await vm.tabRouter.push({ path: `/watch/${video.videoId}`, query: { playlistId: playlist._id, playlistType: 'user', playlistItemId: video.playlistItemId } })
    }, playlist)
    await expect(panel.locator('.playlistTitle')).toHaveText(playlist.playlistName)
  }

  await watch.evaluate(vm => vm.$store.dispatch('updatePlaylist', { _id: 'shuffle-default', shuffleByDefault: true }))
  await switchTo(seeded)
  await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
  await switchTo(otherPlaylist)
  await expect(shuffle).toHaveAttribute('aria-pressed', 'false')

  // Shuffle turned on with the button stays on, even through a playlist with the default.
  await shuffle.click()
  await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
  await switchTo(seeded)
  await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
  await switchTo(otherPlaylist)
  await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
  await watch.dispose()
})
