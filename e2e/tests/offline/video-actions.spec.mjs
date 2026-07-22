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

  test('quick bookmark saves the video to the target playlist', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await expect(video.locator('.quickBookmarkVideoIcon [data-icon="clock"]')).toBeVisible()
    await video.locator('.quickBookmarkVideoIcon').click()

    // The icon flips to its bookmarked state once the video is saved.
    await expect(video.locator('.quickBookmarkVideoIcon.bookmarked')).toBeVisible()

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
