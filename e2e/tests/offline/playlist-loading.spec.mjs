import { test, expect } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      backendFallback: false,
      defaultInvidiousInstance: 'https://invidious.test',
      generalAutoLoadMorePaginatedItemsEnabled: true
    }
  }
})

function playlistVideo(index, videoId = `video-${String(index).padStart(5, '0')}`) {
  return {
    type: 'video',
    title: `Playlist video ${index + 1}`,
    videoId,
    author: 'Playlist channel',
    authorId: 'UCplaylistchannel',
    authorUrl: '/channel/UCplaylistchannel',
    videoThumbnails: [],
    index,
    lengthSeconds: 60,
    liveNow: false
  }
}

function playlistResponse(videos, videoCount = videos.length) {
  return {
    type: 'playlist',
    title: 'Pagination test playlist',
    playlistId: 'pagination-test',
    author: 'Playlist channel',
    authorId: 'UCplaylistchannel',
    authorThumbnails: [
      { url: 'https://yt3.ggpht.com/test=s32' },
      { url: 'https://yt3.ggpht.com/test=s48' },
      { url: 'https://yt3.ggpht.com/test=s76' }
    ],
    description: '',
    descriptionHtml: '',
    videoCount,
    viewCount: 1,
    updated: 1_700_000_000,
    videos
  }
}

async function openPlaylistTab(page, route) {
  const tab = await page.evaluate((playlistRoute) => window.ftElectron.tabs.create({
    route: playlistRoute,
    makeActive: false
  }), route)
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
  await expect(page).toHaveURL(/#\/playlist\//)
}

test('settles a missing user playlist into a persistent not-found state', async ({ page }) => {
  await openPlaylistTab(page, '/playlist/missing-playlist?playlistType=user')

  const playlistPage = page.locator('.playlistPage')
  await expect(playlistPage.getByText('This playlist does not exist', { exact: true })).toBeVisible()
  await expect(playlistPage.locator('[data-tab-loading-indicator]')).toHaveCount(0)
})

test('shows a persistent initial error and retries without navigation', async ({ page }) => {
  let requestCount = 0
  await page.route(/\/api\/v1\/playlists\/initial-retry\?/, async (route) => {
    requestCount++
    if (requestCount === 1) {
      await route.fulfill({ status: 500, json: { error: 'Synthetic initial failure' } })
    } else {
      await route.fulfill({ json: playlistResponse([playlistVideo(0)]) })
    }
  })

  await openPlaylistTab(page, '/playlist/initial-retry')

  const playlistPage = page.locator('.playlistPage')
  await expect(playlistPage.getByText('This playlist could not be loaded.', { exact: true })).toBeVisible()
  await playlistPage.getByRole('button', { name: 'Retry', exact: true }).click()

  await expect(playlistPage.getByText('Playlist video 1', { exact: true })).toBeVisible()
  expect(requestCount).toBe(2)
})

test('retries the failed Invidious page and merges its overlapping videos once', async ({ page }) => {
  const requestedPages = []
  await page.route(/\/api\/v1\/playlists\/pagination-test\?/, async (route) => {
    const pageNumber = new URL(route.request().url()).searchParams.get('page')
    if (pageNumber === null) {
      await route.fulfill({ json: playlistResponse([playlistVideo(0), playlistVideo(1)], 150) })
      return
    }

    requestedPages.push(pageNumber)
    if (requestedPages.length === 1) {
      await route.fulfill({ status: 500, json: { error: 'Synthetic continuation failure' } })
      return
    }

    await route.fulfill({
      json: playlistResponse([playlistVideo(1), playlistVideo(2), playlistVideo(3)], 150)
    })
  })

  await openPlaylistTab(page, '/playlist/pagination-test')
  const playlistPage = page.locator('.playlistPage')
  await expect(playlistPage.getByText('Playlist video 1', { exact: true })).toBeVisible()

  await expect(playlistPage.getByText('More videos could not be loaded.', { exact: true })).toBeVisible()
  await playlistPage.getByRole('button', { name: 'Retry', exact: true }).click()

  await expect(playlistPage.getByText('Playlist video 4', { exact: true })).toBeVisible()
  await expect(playlistPage.getByText('Playlist video 2', { exact: true })).toHaveCount(1)
  await expect(playlistPage.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
  expect(requestedPages).toEqual(['2', '2'])
})
