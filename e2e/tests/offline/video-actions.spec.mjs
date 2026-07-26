import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo } from '../../helpers/app.mjs'

function historyEntry(videoId, title) {
  return {
    _id: videoId,
    videoId,
    title,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    published: Date.now() - 86_400_000,
    description: '',
    viewCount: 1234,
    lengthSeconds: 60,
    watchProgress: 10,
    isWatched: false,
    timeWatched: Date.now() - 1000,
    isLive: false,
    type: 'video'
  }
}

test.use({
  seed: {
    settings: { quickBookmarkTargetPlaylistId: 'favorites' },
    playlists: [
      {
        _id: 'favorites',
        playlistName: 'Favorites',
        protected: true,
        description: '',
        quickBookmarkIcon: 'clock',
        videos: [],
        createdAt: Date.now() - 86_400_000,
        lastUpdatedAt: Date.now() - 86_400_000
      },
      {
        _id: 'saved-videos',
        playlistName: 'Saved videos',
        protected: false,
        description: '',
        videos: [historyEntry('eeeeeeeeeee', 'Bookmarkable video')],
        createdAt: Date.now() - 86_400_000,
        lastUpdatedAt: Date.now() - 86_400_000
      }
    ],
    history: [historyEntry('eeeeeeeeeee', 'Bookmarkable video')]
  }
})

async function readPlaylist(app, id) {
  const contents = await readFile(path.join(app.userDataDir, 'playlists.db'), 'utf8')
  const records = contents.trim().split('\n').map((line) => JSON.parse(line))
  return records.filter((record) => record._id === id).at(-1)
}

test.describe('list video actions', () => {
  test('the options dropdown shows an icon for each action', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()

    const actions = page.getByRole('option')
    await expect(actions).not.toHaveCount(0)
    await expect(actions.locator('.optionIconColumn svg')).toHaveCount(await actions.count())
  })

  test('shows a filled playlist icon when the video is already in a playlist', async ({ page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await expect(video.locator('.addToPlaylistIcon [data-prefix="fac"][data-icon="playlist-check"]')).toBeVisible()
  })

  test('add to playlist dropdown shows membership and toggles it', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()

    const dropdown = video.locator('.addToPlaylistIcon .iconDropdown')
    const favoritesRow = dropdown.locator('.playlistRow', { hasText: 'Favorites' })
    const savedVideosRow = dropdown.locator('.playlistRow', { hasText: 'Saved videos' })

    // The video is seeded into "Saved videos" but not "Favorites"
    await expect(savedVideosRow.locator('[data-prefix="fas"][data-icon="bookmark"]')).toBeVisible()
    await expect(favoritesRow.locator('[data-prefix="far"][data-icon="bookmark"]')).toBeVisible()
    await expect(favoritesRow.locator('.playlistThumbnail')).toBeVisible()

    // Clicking a row adds the video, keeps the dropdown open and names the playlist in the toast
    await favoritesRow.click()
    await expect(favoritesRow.locator('[data-prefix="fas"][data-icon="bookmark"]')).toBeVisible()
    await expect(page.locator('.toast .message', { hasText: 'Video has been saved to Favorites' })).toBeVisible()
    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.map((entry) => entry.videoId)
    }).toEqual(['eeeeeeeeeee'])

    // Playlist entries must not carry the attributes the store strips
    const saved = (await readPlaylist(app, 'favorites')).videos[0]
    expect(saved).not.toHaveProperty('description')
    expect(saved).not.toHaveProperty('viewCount')

    // Clicking it again removes the video
    await favoritesRow.click()
    await expect(favoritesRow.locator('[data-prefix="far"][data-icon="bookmark"]')).toBeVisible()
    await expect(page.locator('.toast .message', { hasText: 'Video has been removed from Favorites' })).toBeVisible()
    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.length
    }).toBe(0)
  })

  test('rapidly clicking a playlist row does not add duplicate entries', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()

    const favoritesRow = video.locator('.addToPlaylistIcon .iconDropdown .playlistRow', { hasText: 'Favorites' })

    // Two activations before the first write can commit must still only add one entry
    await favoritesRow.dblclick()

    await expect(favoritesRow.locator('[data-prefix="fas"][data-icon="bookmark"]')).toBeVisible()
    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.length
    }).toBe(1)
  })

  test('the dropdown and quick bookmark cannot both add the same video', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()

    const favoritesRow = video.locator('.addToPlaylistIcon .iconDropdown .playlistRow', { hasText: 'Favorites' })
    await expect(favoritesRow).toBeVisible()

    // "Favorites" is also the quick bookmark target, so activating both controls
    // in the same tick races two adds against the same playlist
    await page.evaluate(() => {
      const listVideo = document.querySelector('.ft-list-video')
      const row = [...listVideo.querySelectorAll('.addToPlaylistIcon .iconDropdown .playlistRow')]
        .find((element) => element.textContent.includes('Favorites'))

      row.click()
      listVideo.querySelector('.quickBookmarkVideoIcon .iconButton').click()
    })

    await expect(video.locator('.quickBookmarkVideoIcon.bookmarked')).toBeVisible()
    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.length
    }).toBe(1)
  })

  test('creating a playlist from the dropdown puts the video in it', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.addToPlaylistIcon .iconButton').click()
    await video.locator('.addToPlaylistIcon .createRow').click()

    await page.locator('.playlistNameInput input').fill('Cool clips')
    await page.getByRole('button', { name: 'Create', exact: true }).click()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'playlists.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      const created = records.filter((record) => record.playlistName === 'Cool clips').at(-1)
      return created?.videos?.map((entry) => entry.videoId)
    }).toEqual(['eeeeeeeeeee'])
  })

  test('quick bookmark saves the video to the target playlist', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await expect(video.locator('.quickBookmarkVideoIcon [data-icon="clock"]')).toBeVisible()
    await video.locator('.quickBookmarkVideoIcon').click()

    // Once saved, the button keeps the configured icon and overlays a checkmark on it.
    await expect(video.locator('.quickBookmarkVideoIcon.bookmarked')).toBeVisible()
    await expect(video.locator('.quickBookmarkVideoIcon [data-icon="clock"]')).toBeVisible()
    await expect(video.locator('.quickBookmarkVideoIcon .overlayIcon[data-icon="check"]')).toBeVisible()
    await expect(page.locator('.toast .message', { hasText: 'Video has been saved to Favorites' })).toBeVisible()

    await expect.poll(async () => {
      const favorites = await readPlaylist(app, 'favorites')
      return favorites?.videos?.map((entry) => entry.videoId)
    }).toEqual(['eeeeeeeeeee'])
  })

  test('the options dropdown toggles watched status separately from removing history', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Mark As Watched' }).click()

    // The watched action changes independently and keeps the history entry.
    await video.hover()
    await video.locator('.optionsButton').click()
    await expect(page.getByRole('option', { name: 'Unmark As Watched' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Remove From History' })).toBeVisible()
    await page.getByRole('option', { name: 'Unmark As Watched' }).click()

    await expect(page.getByText('Bookmarkable video')).toBeVisible()
    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.filter((record) => record._id === 'eeeeeeeeeee').at(-1)?.isWatched
    }).toBe(false)

    await video.hover()
    await video.locator('.optionsButton').click()
    await page.getByRole('option', { name: 'Remove From History' }).click()

    await expect(page.getByText('Bookmarkable video')).toBeHidden()
    await expect(page.getByText('Your history list is currently empty.')).toBeVisible()

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.filter((record) => record._id === 'eeeeeeeeeee').at(-1)?.$$deleted
    }).toBe(true)
  })
})
