import { test, expect } from '../../helpers/app.mjs'
import { openPagedPlaylist, pagedPlaylistVideoId, waitForPlaylistPagesIdle } from '../../helpers/pagedPlaylist.mjs'

test.use({
  seed: {
    settings: {
      backendFallback: false,
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    }
  }
})

test('sequential playback of a long playlist requests only the pages it is about to reach', async ({ app, page }) => {
  // 100 pages, of which the playlist page cached the first
  const { watch, panel, requestedPages } = await openPagedPlaylist({ app, page }, { videoCount: 10_000 })

  await expect(panel.locator('.playlistIndex label')).toHaveText('1 / 10000')
  await waitForPlaylistPagesIdle(watch)
  expect(requestedPages).toEqual([])

  for (let index = 1; index <= 3; index++) {
    await watch.evaluate(view => view.$refs.watchVideoPlaylist.playNextVideo())
    await expect(page).toHaveURL(new RegExp(`#/watch/${pagedPlaylistVideoId(index, 0)}\\?`))
    await waitForPlaylistPagesIdle(watch)
  }
  expect(requestedPages).toEqual([])

  // Within 50 videos of the loaded end, the next page loads ahead of playback
  await watch.evaluate((view, videoId) => view.tabRouter.push({ path: `/watch/${videoId}`, query: { playlistId: view.playlistId } }), pagedPlaylistVideoId(60, 0))
  await expect.poll(() => requestedPages).toEqual([2])
  await waitForPlaylistPagesIdle(watch)
  await expect(panel.locator('.playlistItem')).toHaveCount(200)
  expect(requestedPages).toEqual([2])
})

test('a current video on a later page loads the playlist only until it is found', async ({ app, page }) => {
  const { watch, panel, requestedPages } = await openPagedPlaylist({ app, page }, { videoCount: 10_000, playableIndex: 420 })

  await expect(panel.locator('.playlistIndex label')).toHaveText('421 / 10000')
  await waitForPlaylistPagesIdle(watch)
  expect(requestedPages).toEqual([2, 3, 4, 5])
  await expect(panel.locator('.playlistItem')).toHaveCount(500)
})
