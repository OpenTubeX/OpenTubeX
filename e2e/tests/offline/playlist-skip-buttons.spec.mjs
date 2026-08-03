import { goTo, test, expect } from '../../helpers/app.mjs'

const VIDEO_TITLES = ['Skip test video one', 'Skip test video two', 'Skip test video three']

test.use({
  seed: {
    settings: {
      // Keep the seeded order, the default sorts the newest addition to the top
      userPlaylistSortOrder: 'custom'
    },
    playlists: [
      {
        _id: 'e2eskipplaylist',
        playlistName: 'Skip button playlist',
        protected: false,
        description: 'Playlist for the player skip buttons',
        videos: VIDEO_TITLES.map((title, index) => ({
          videoId: `skipvideo${index}`,
          title,
          author: 'Test Channel',
          authorId: 'UC-test-channel-id',
          lengthSeconds: 120,
          published: Date.now() - 86_400_000,
          timeAdded: Date.now() + index,
          playlistItemId: `e2e-skip-item-${index}`,
          type: 'video'
        })),
        createdAt: Date.now() - 86_400_000,
        lastUpdatedAt: Date.now()
      }
    ]
  }
})

/**
 * The videos themselves cannot be loaded offline, but the playlist is local, so the
 * watch view still decides which skip buttons the player is allowed to show.
 */
function readSkipAvailability(page) {
  return page.evaluate(() => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') {
        return vnode.component.proxy
      }
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) {
      throw new Error('Unable to access the watch view')
    }

    return {
      canPlayNext: watchView.canSkipToNextPlaylistVideo,
      canPlayPrevious: watchView.canSkipToPreviousPlaylistVideo
    }
  })
}

test('only offers skipping to playlist videos that exist', async ({ page }) => {
  await page.route(/^https?:\/\//, (route) => route.abort())

  await goTo(page, 'userplaylists')
  await page.getByText('Skip button playlist').click()
  await expect(page).toHaveURL(/#\/playlist\/e2eskipplaylist/)

  await page.getByText(VIDEO_TITLES[0]).first().click()
  await expect(page).toHaveURL(/#\/watch\/skipvideo0\?.*playlistId=e2eskipplaylist/)

  const playlistItems = page.locator('.watchVideoPlaylist .playlistItem')
  await expect(playlistItems).toHaveCount(VIDEO_TITLES.length)

  // First video: nothing before it
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: true,
    canPlayPrevious: false
  })

  // Loop wraps the playlist around in both directions
  const loopButton = page.locator('.watchVideoPlaylist .playlistButton').first()
  await loopButton.click()
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: true,
    canPlayPrevious: true
  })
  await loopButton.click()

  // Last video: nothing after it
  await playlistItems.last().getByText(VIDEO_TITLES[2]).click()
  await expect(page).toHaveURL(/#\/watch\/skipvideo2\?.*playlistId=e2eskipplaylist/)
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: false,
    canPlayPrevious: true
  })

  // Middle video: both directions available
  await playlistItems.nth(1).getByText(VIDEO_TITLES[1]).click()
  await expect(page).toHaveURL(/#\/watch\/skipvideo1\?.*playlistId=e2eskipplaylist/)
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: true,
    canPlayPrevious: true
  })
})
