import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, sel, goTo } from '../../helpers/app.mjs'

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
      settings: {
        hideUpcomingPremieres: true,
        quickBookmarkTargetPlaylistId: 'favorites'
      },
      playlists: [
        {
          _id: 'favorites',
          playlistName: 'Favorites',
          protected: true,
          description: 'Quick bookmark target',
          videos: [],
          createdAt: Date.now() - 86_400_000,
          lastUpdatedAt: Date.now()
        },
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
            },
            {
              videoId: 'ddddddddddd',
              title: 'Upcoming seeded premiere',
              author: 'Test Channel',
              authorId: 'UC-test-channel-id',
              lengthSeconds: 120,
              published: Date.now() + 86_400_000,
              premiereDate: new Date(Date.now() + 86_400_000).toISOString(),
              timeAdded: Date.now(),
              playlistItemId: 'e2e-item-2',
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
    // Local playlists intentionally ignore the global hide-upcoming setting.
    await expect(page.getByText('Upcoming seeded premiere')).toBeVisible()
  })

  test('playlist artwork keeps its native aspect ratio', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()

    const thumbnail = page.locator('.playlistThumbnail img')
    await page.addStyleTag({ content: '.playlistThumbnail { display: block !important; }' })
    await thumbnail.evaluate((image) => {
      image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"/>'
    })
    await expect(thumbnail).toBeVisible()
    await expect(thumbnail).toHaveJSProperty('complete', true)

    const bounds = await thumbnail.boundingBox()
    expect(bounds.width).toBe(bounds.height)
  })

  test('keeps the playlist title when switching tabs', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()
    await expect(page.locator(sel.activeTab)).toContainText('My seeded playlist')

    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    // Wait for the new tab to settle on its landing page before switching back.
    // Clicking while its title is still resolving races the tab bar re-render,
    // and the switch can be lost on a loaded machine.
    await expect(page.locator(sel.activeTab)).toContainText('Subscriptions')
    await expect(page.locator(sel.activeTab)).not.toContainText('My seeded playlist')
    await page.locator(sel.tabs).filter({ hasText: 'My seeded playlist' }).click()

    await expect(page.locator(sel.activeTab)).toContainText('My seeded playlist')
  })

  test('playlist edits and deletion persist across restarts', async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()

    await page.getByTitle('Edit Playlist Info').click()
    await page.locator('.playlistStats input').fill('Renamed seeded playlist')
    await page.locator('.descriptionInput input').fill('Updated through E2E')
    await page.getByTitle('Save Changes').click()

    await expect(page.locator('.playlistTitle')).toHaveText('Renamed seeded playlist')
    await expect(page.locator('.playlistDescription')).toHaveText('Updated through E2E')

    ;({ page } = await app.relaunch())
    await goTo(page, 'userplaylists')
    await page.getByText('Renamed seeded playlist').click()
    await expect(page.locator('.playlistDescription')).toHaveText('Updated through E2E')

    await page.getByTitle('Delete Playlist').click()
    await page.getByRole('button', { name: 'Yes, Delete' }).click()
    await expect(page).toHaveURL(/#\/userplaylists\/?$/)
    await expect(page.locator(sel.activeTab).locator('[data-icon="bookmark"]')).toBeVisible()
    await expect(page.getByText('Renamed seeded playlist')).toHaveCount(0)

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'playlists.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.filter((record) => record._id === 'e2eseeded').at(-1)?.$$deleted
    }).toBe(true)
  })

  test('a custom quick bookmark icon persists across restarts', async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Favorites').click()

    await page.getByTitle('Edit Playlist Info').click()
    await page.getByRole('button', { name: 'Watch later' }).click()
    await page.getByTitle('Save Changes').click()

    const quickBookmarkButton = page.getByTitle('Quick Bookmark Enabled')
    await expect(quickBookmarkButton.locator('[data-icon="clock"]')).toBeVisible()

    ;({ page } = await app.relaunch())
    await goTo(page, 'userplaylists')
    await page.getByText('Favorites').click()
    await expect(page.getByTitle('Quick Bookmark Enabled').locator('[data-icon="clock"]')).toBeVisible()
  })
})

test.describe('custom playlist order', () => {
  test.use({
    seed: {
      settings: {
        listType: 'grid',
        userPlaylistSortOrder: 'custom'
      },
      playlists: [
        {
          _id: 'large-custom-playlist',
          playlistName: 'Large custom playlist',
          protected: false,
          description: '',
          videos: Array.from({ length: 101 }, (_, index) => ({
            videoId: String(index).padStart(11, '0'),
            title: `Custom playlist video ${index + 1}`,
            author: 'Test Channel',
            authorId: 'UC-test-channel-id',
            lengthSeconds: 120,
            published: Date.now() - 86_400_000,
            timeAdded: Date.now() - index,
            playlistItemId: `custom-playlist-item-${index}`,
            type: 'video'
          })),
          createdAt: Date.now() - 86_400_000,
          lastUpdatedAt: Date.now()
        }
      ]
    }
  })

  test('keeps the grid grab bars in place during the removal undo period', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Large custom playlist').click()

    const secondVideo = page.locator('.ft-list-video').filter({
      has: page.getByText('Custom playlist video 2', { exact: true })
    })
    await expect(secondVideo.locator('.grabBar')).toBeVisible()
    await secondVideo.getByTitle('Remove from Playlist').click()

    await expect(secondVideo).toHaveCount(0)
    await expect(page.locator('.playlistItemsCard .grid.draggable .grabBar').first()).toBeVisible()

    const thirdVideo = page.locator('.ft-list-video').filter({
      has: page.getByText('Custom playlist video 3', { exact: true })
    })
    await thirdVideo.getByTitle('Move Video Up').click()
    await expect(page.locator('.playlistItemsCard .h3Title').first()).toHaveText('Custom playlist video 3')
  })
})
