import { test, expect } from '../../helpers/app.mjs'

const videos = Array.from({ length: 300 }, (_, index) => ({
  type: 'video',
  title: `Windowed video ${index + 1}`,
  videoId: `window${String(index).padStart(5, '0')}`,
  author: 'Playlist channel',
  authorId: 'UCplaylistchannel',
  authorUrl: '/channel/UCplaylistchannel',
  videoThumbnails: [],
  index,
  lengthSeconds: 60,
}))

test.use({
  seed: {
    settings: {
      playlistViewType: 'list',
      backendPreference: 'invidious',
      backendFallback: false,
      enableSearchSuggestions: false,
      defaultInvidiousInstance: 'https://invidious.test',
      generalAutoLoadMorePaginatedItemsEnabled: false,
    },
  },
})

test('releases distant playlist rows without changing the scroll range', { tag: '@scale' }, async ({ page }) => {
  await page.route(/\/api\/v1\/playlists\/windowing\?/, route => route.fulfill({
    json: {
      title: 'Windowed playlist',
      playlistId: 'windowing',
      author: 'Playlist channel',
      authorId: 'UCplaylistchannel',
      authorThumbnails: [],
      description: '',
      videoCount: videos.length,
      viewCount: 1,
      updated: 1_700_000_000,
      videos,
    },
  }))
  const tab = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/playlist/windowing', makeActive: false }))
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
  const rows = page.locator('.playlistItems > .playlistItem')
  await expect(rows).toHaveCount(videos.length)
  const mountedRows = rows.filter({ has: page.locator('.ft-list-video') })

  // Visit every row so each one mounts once and records its real height.
  const scrollRange = () => page.evaluate(() => document.documentElement.scrollHeight)
  const viewportMounted = () => page.evaluate(() => [...document.querySelectorAll('.playlistItems > .playlistItem')]
    .filter(row => {
      const { top, bottom } = row.getBoundingClientRect()
      return bottom > 0 && top < window.innerHeight
    })
    .every(row => row.querySelector('.ft-list-video')))
  const atEnd = () => page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1)
  do {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight))
    await expect.poll(viewportMounted).toBe(true)
  } while (!await atEnd())
  await expect(rows.last().locator('.ft-list-video')).toBeVisible()

  // Rows near the top were released to shells sized like the mounted rows.
  await expect(rows.first().locator('.ft-list-video')).toHaveCount(0)
  const mountedCount = await mountedRows.count()
  expect(mountedCount).toBeLessThan(videos.length / 2)
  const range = await scrollRange()
  const scrollY = await page.evaluate(() => window.scrollY)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(rows.first().locator('.ft-list-video')).toBeVisible()
  await expect(rows.last().locator('.ft-list-video')).toHaveCount(0)
  expect(Math.abs(await scrollRange() - range)).toBeLessThanOrEqual(1)

  // Returning to the end restores the same offset without empty space.
  await page.evaluate(top => window.scrollTo(0, top), scrollY)
  await expect(rows.last().locator('.ft-list-video')).toBeVisible()
  expect(Math.abs(await page.evaluate(() => window.scrollY) - scrollY)).toBeLessThanOrEqual(1)
})
