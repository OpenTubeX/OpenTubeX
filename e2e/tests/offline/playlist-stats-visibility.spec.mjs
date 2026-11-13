import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

test.use({
  seed: {
    playlists: [{
      _id: 'stats-playlist',
      playlistName: 'Stats playlist',
      description: 'Playlist description',
      protected: false,
      lastUpdatedAt: 1700000000000,
      videos: [{
        videoId: 'statsvideo0',
        playlistItemId: 'stats-playlist-0',
        title: 'Video 1',
        author: 'Test channel',
        lengthSeconds: 65,
        type: 'video',
      }],
    }],
  },
})

test('Distraction Free hides playlist stats and saves the preference', async ({ app, page }) => {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await goTo(page, 'userplaylists')
  await page.getByRole('link', { name: 'Stats playlist', exact: true }).click()

  const stats = page.locator('.playlistStats')
  await expect(stats).toContainText('1 video')
  await expect(stats).toContainText('Total time: 1:05')

  const focus = await goToSettingsSection(page, 'focus')
  const toggle = focus.getByRole('checkbox', { name: 'Hide Playlist Stats' })
  await expect(toggle).not.toBeChecked()
  await toggle.locator('..').locator('label.switch-label').click()
  await expect(toggle).toBeChecked()
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()

  await expect(stats.getByRole('heading', { name: 'Stats playlist' })).toBeVisible()
  await expect(stats).not.toContainText('1 video')
  await expect(stats).not.toContainText('Total time')
  await expect(page.locator('.playlistDescription')).toHaveText('Playlist description')

  const { page: relaunched } = await app.relaunch()
  const restored = await goToSettingsSection(relaunched, 'focus')
  await expect(restored.getByRole('checkbox', { name: 'Hide Playlist Stats' })).toBeChecked()
})
