import { test, expect, goTo } from '../../helpers/app.mjs'

test.describe('playlist creation', () => {
  test('a playlist can be created through the UI', async ({ page }) => {
    await goTo(page, 'userplaylists')

    await page.getByTitle('Create New Playlist').click()
    await page.locator('.playlistNameInput input').fill('Created via UI')
    await page.getByRole('button', { name: 'Create', exact: true }).click()

    await expect(page.getByRole('link', { name: 'Created via UI' })).toBeVisible()
  })
})

test.describe('seeded playlists', () => {
  test.use({
    seed: {
      playlists: [
        {
          _id: 'e2eseeded',
          playlistName: 'My seeded playlist',
          protected: false,
          description: 'Playlist created by the E2E seed',
          videos: [
            {
              videoId: 'ccccccccccc',
              title: 'Seeded video one',
              author: 'Test Channel',
              authorId: 'UC-test-channel-id',
              lengthSeconds: 120,
              published: Date.now() - 86_400_000,
              timeAdded: Date.now(),
              playlistItemId: 'e2e-item-1',
              type: 'video'
            }
          ],
          createdAt: Date.now() - 86_400_000,
          lastUpdatedAt: Date.now()
        }
      ]
    }
  })

  test('a seeded playlist with videos renders and opens', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await expect(page.getByText('My seeded playlist')).toBeVisible()

    await page.getByText('My seeded playlist').click()
    await expect(page).toHaveURL(/#\/playlist\//)
    await expect(page.getByText('Seeded video one')).toBeVisible()
  })
})
