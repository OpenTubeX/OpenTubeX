import { test, expect, goTo } from '../../helpers/app.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const playlists = [
  { id: 'day-total', name: 'Long playlist', durations: [86400, 3661.75], total: '1:01:01:01' },
  { id: 'short-total', name: 'Short playlist', durations: [60, 5], total: '1:05' },
]

test.use({
  seed: {
    playlists: playlists.map(({ id, name, durations }) => ({
      _id: id,
      playlistName: name,
      description: '',
      protected: false,
      lastUpdatedAt: 1700000000000,
      videos: durations.map((lengthSeconds, index) => ({
        videoId: `duration00${index}`,
        playlistItemId: `${id}-${index}`,
        title: `Video ${index + 1}`,
        author: 'Test channel',
        lengthSeconds,
        type: 'video',
      })),
    })),
  },
})

test('playlist totals use day-aware timestamps and whole seconds', async ({ page }) => {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))

  for (const { name, total } of playlists) {
    await goTo(page, 'userplaylists')
    await page.getByRole('link', { name, exact: true }).click()
    await expect(page.locator('.playlistStats')).toContainText(`Total time: ${total}`)
  }
})
