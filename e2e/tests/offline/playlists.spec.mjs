import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, sel, goTo } from '../../helpers/app.mjs'
import { rejectDatastoreRequests } from '../../helpers/datastore-failure.mjs'
import { IpcChannels } from '../../../src/constants.js'

test.describe('playlist creation', () => {
  test.use({ seed: { settings: { currentLocale: 'en-US' } } })

  test('a playlist can be created through the UI', async ({ page }) => {
    await goTo(page, 'userplaylists')

    await page.getByTitle('Create New Playlist').click()
    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible()
    await expect(createDialog.getByText('Quick bookmark icon')).toHaveCount(0)
    await createDialog.locator('.playlistNameInput input').fill('Created via UI')
    await createDialog.getByRole('button', { name: 'Create', exact: true }).click()

    await expect(page.getByRole('link', { name: 'Created via UI' })).toBeVisible()
  })

  test('playlist actions reject when persistence fails', async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    await expect(page.getByRole('link', { name: 'Favorites' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Watch Later' })).toBeVisible()
    await rejectDatastoreRequests(app.electronApp, IpcChannels.DB_PLAYLISTS)

    const result = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const existingPlaylists = store.state.playlists.playlists.map(({ _id, playlistName }) => ({
        _id,
        playlistName,
      }))
      const favorites = store.state.playlists.playlists.find(playlist => playlist._id === 'favorites')
      const [create, createMany, update] = await Promise.allSettled([
        store.dispatch('addPlaylist', {
          playlistName: 'Rejected playlist',
          protected: false,
          description: '',
          videos: [],
        }),
        store.dispatch('addPlaylists', [{
          playlistName: 'Another rejected playlist',
          protected: false,
          description: '',
          videos: [],
        }]),
        store.dispatch('updatePlaylist', {
          ...favorites,
          playlistName: 'Rejected update',
          videos: favorites.videos.slice(),
        }),
      ])

      return {
        statuses: [create.status, createMany.status, update.status],
        playlists: store.state.playlists.playlists.map(({ _id, playlistName }) => ({
          _id,
          playlistName,
        })),
        existingPlaylists,
      }
    })

    expect(result.statuses).toEqual(['rejected', 'rejected', 'rejected'])
    expect(result.playlists).toEqual(result.existingPlaylists)
  })

  test('keeps the create dialog and its input when persistence fails', async ({ app, page }) => {
    await goTo(page, 'userplaylists')

    await page.getByTitle('Create New Playlist').click()
    const createDialog = page.getByRole('dialog')
    const nameInput = createDialog.locator('.playlistNameInput input')
    await nameInput.fill('Unsaved playlist')
    await rejectDatastoreRequests(app.electronApp, IpcChannels.DB_PLAYLISTS)
    await createDialog.getByRole('button', { name: 'Create', exact: true }).click()

    await expect(createDialog).toBeVisible()
    await expect(nameInput).toHaveValue('Unsaved playlist')
    await expect(createDialog.getByText('There was an issue with creating the playlist.')).toBeVisible()
    await expect(page.locator('.toast', { hasText: 'has been successfully created' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Unsaved playlist' })).toHaveCount(0)
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

  test('keeps playlist edits open when persistence fails', async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('My seeded playlist').click()

    await page.getByTitle('Edit Playlist Info').click()
    const titleInput = page.locator('.playlistStats input')
    const descriptionInput = page.locator('.descriptionInput input')
    await titleInput.fill('Unsaved playlist title')
    await descriptionInput.fill('Unsaved playlist description')
    await rejectDatastoreRequests(app.electronApp, IpcChannels.DB_PLAYLISTS)
    await page.getByTitle('Save Changes').click()

    await expect(titleInput).toBeVisible()
    await expect(titleInput).toHaveValue('Unsaved playlist title')
    await expect(descriptionInput).toHaveValue('Unsaved playlist description')
    await expect(page.locator('.toast', { hasText: 'There was an issue with updating this playlist.' })).toBeVisible()
    await expect(page.locator('.toast', { hasText: 'Playlist has been updated.' })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const playlist = store.getters.getPlaylist('e2eseeded')
      return [playlist.playlistName, playlist.description]
    })).toEqual(['My seeded playlist', 'Playlist created by the E2E seed'])
  })

  test('a custom quick bookmark emoji persists across restarts', async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Favorites').click()

    await page.getByTitle('Edit Playlist Info').click()
    await page.getByLabel('Custom emoji').fill('❤️‍🔥')
    await page.getByTitle('Save Changes').click()

    const quickBookmarkButton = page.getByTitle('Quick Bookmark Enabled')
    await expect(quickBookmarkButton.locator('.ft-custom-icon__emoji')).toHaveText('❤️‍🔥')

    ;({ page } = await app.relaunch())
    await goTo(page, 'userplaylists')
    await page.getByText('Favorites').click()
    await expect(page.getByTitle('Quick Bookmark Enabled').locator('.ft-custom-icon__emoji')).toHaveText('❤️‍🔥')
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

  test('keeps the playlist header below the navigation while scrolling the grid', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Large custom playlist').click()

    const expectHeaderBelowNavigation = async () => {
      const playlistHeader = page.locator('.playlistInfoContainer')
      await expect(playlistHeader).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, Number.MAX_SAFE_INTEGER))
      await expect.poll(async () => page.evaluate(() => {
        const previousScrollY = window.scrollY
        window.scrollTo(0, Number.MAX_SAFE_INTEGER)
        return window.scrollY - previousScrollY
      })).toBe(0)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

      await expect.poll(async () => {
        const [header, navigation, viewportHeight] = await Promise.all([
          playlistHeader.boundingBox(),
          page.locator('.topNav').boundingBox(),
          page.evaluate(() => window.innerHeight)
        ])
        return header != null && navigation != null &&
          header.y >= navigation.y + navigation.height &&
          header.y < viewportHeight && header.y + header.height > 0
      }).toBe(true)
    }

    await expectHeaderBelowNavigation()

    await page.keyboard.press('F1')
    await expect(page.locator('.app')).toHaveClass(/verticalTabs/)
    await expectHeaderBelowNavigation()
  })

  test('moves a video to the top from its options menu', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Large custom playlist').click()

    const thirdVideo = page.locator('.ft-list-video').filter({
      has: page.getByText('Custom playlist video 3', { exact: true })
    })
    await thirdVideo.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Move Video to the Top' }).click()

    await expect(page.locator('.playlistItemsCard .h3Title').first()).toHaveText('Custom playlist video 3')
  })

  test('keeps newer playlist state when an earlier reorder fails', async ({ app, page }) => {
    await goTo(page, 'userplaylists')
    await page.getByText('Large custom playlist').click()

    const secondVideo = page.locator('.ft-list-video').filter({
      has: page.getByText('Custom playlist video 2', { exact: true })
    })
    await rejectDatastoreRequests(app.electronApp, IpcChannels.DB_PLAYLISTS, 500)
    await secondVideo.getByTitle('Move Video Up').click()
    await expect(page.locator('.playlistItemsCard .h3Title').first()).toHaveText('Custom playlist video 2')

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const playlist = store.getters.getPlaylist('large-custom-playlist')
      store.commit('upsertPlaylistToList', {
        ...playlist,
        lastUpdatedAt: Date.now(),
        videos: playlist.videos.toSpliced(2, 0, {
          videoId: 'concurrent1',
          title: 'Concurrent playlist video',
          author: 'Test Channel',
          authorId: 'UC-test-channel-id',
          lengthSeconds: 120,
          published: Date.now() - 86_400_000,
          timeAdded: Date.now(),
          playlistItemId: 'concurrent-playlist-item',
          type: 'video'
        })
      })
    })

    await expect(page.locator('.toast', { hasText: 'There was an issue with updating this playlist.' })).toBeVisible()
    await expect(page.locator('.playlistItemsCard .h3Title').first()).toHaveText('Custom playlist video 1')
    await expect(page.getByText('Concurrent playlist video', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const videos = store.getters.getPlaylist('large-custom-playlist').videos
      return {
        firstIds: videos.slice(0, 2).map(video => video.playlistItemId),
        thirdId: videos[2].playlistItemId,
      }
    })).toEqual({
      firstIds: ['custom-playlist-item-0', 'custom-playlist-item-1'],
      thirdId: 'concurrent-playlist-item',
    })
  })
})
