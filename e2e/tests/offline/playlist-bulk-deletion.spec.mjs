import { test, expect, goTo } from '../../helpers/app.mjs'

const playlists = [
  { _id: 'remove', playlistName: 'Remove this playlist', videos: [{ videoId: 'abcdefghijk', title: 'Shared video' }, { videoId: 'bcdefghijkl', title: 'Removed video' }] },
  { _id: 'keep', playlistName: 'Keep this playlist', videos: [{ videoId: 'abcdefghijk', title: 'Shared video' }] },
  { _id: 'protected', playlistName: 'Protected playlist', protected: true, videos: [] },
]
test.use({ seed: { playlists, settings: { pinnedPlaylistIds: ['remove', 'protected'] } } })

test('bulk deletion updates the overview and persists while preserving protected playlists', async ({ page, app }) => {
  await goTo(page, 'userplaylists')
  await expect(page.getByText('Remove this playlist', { exact: true })).toBeVisible()
  await page.evaluate(() => window.$store.dispatch('removePlaylists', ['remove', 'protected']))
  await expect(page.getByText('Remove this playlist', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Keep this playlist', { exact: true })).toBeVisible()
  await expect(page.getByText('Protected playlist', { exact: true })).toBeVisible()
  // Only the playlist that was actually deleted leaves the navigation.
  await expect.poll(() => page.evaluate(() => window.$store.getters.getPinnedPlaylistIds)).toEqual(['protected'])
  expect(await page.evaluate(() => {
    const counts = window.$store.getters.getPlaylistVideoCounts
    return { shared: counts.get('abcdefghijk'), removed: counts.has('bcdefghijkl') }
  })).toEqual({ shared: 1, removed: false })
  const relaunched = await app.relaunch()
  await goTo(relaunched.page, 'userplaylists')
  await expect(relaunched.page.getByText('Remove this playlist', { exact: true })).toHaveCount(0)
  await expect(relaunched.page.getByText('Keep this playlist', { exact: true })).toBeVisible()
  await expect(relaunched.page.getByText('Protected playlist', { exact: true })).toBeVisible()
})
