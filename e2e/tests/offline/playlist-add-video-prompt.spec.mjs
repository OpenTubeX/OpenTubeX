import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const video = (index) => ({
  videoId: `video${String(index).padStart(6, '0')}`,
  title: `Video number ${index}`,
  author: `Channel ${index}`,
  lengthSeconds: 60,
})

async function showPrompt(page, videos) {
  await page.evaluate(videos => window.$store.dispatch('showAddToPlaylistPromptForManyVideos', { videos }), videos)
}

test.beforeEach(async ({ page }) => {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
})

test('shows the video being added', async ({ page, attachScreenshot }) => {
  await showPrompt(page, [video(1)])
  const prompt = page.getByRole('dialog', { name: 'Select a playlist to add your video to', exact: true })
  const items = prompt.locator('.videoSummaryItem')

  await expect(items).toHaveCount(1)
  await expect(items).toContainText('Video number 1')
  await expect(items).toContainText('Channel 1')
  await expectImagesLoaded(items.locator('img'))
  await expect(prompt.locator('.videoSummaryMore')).toHaveCount(0)
  await attachScreenshot('add-to-playlist-single-video')
})

test('lists the first videos and counts the rest when adding many', async ({ page, attachScreenshot }) => {
  await showPrompt(page, [1, 2, 3, 4, 5].map(video))
  const prompt = page.getByRole('dialog', { name: 'Select a playlist to add your 5 videos to', exact: true })

  await expect(prompt.locator('.videoSummaryTitle')).toHaveText(['Video number 1', 'Video number 2', 'Video number 3'])
  await expect(prompt.locator('.videoSummaryMore')).toHaveText('and 2 more videos')
  await expectImagesLoaded(prompt.locator('.videoSummaryThumbnail'))
  await attachScreenshot('add-to-playlist-many-videos')
})

test('previews only one video in the phone layout', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 480, height: 800 })
  await showPrompt(page, [1, 2, 3, 4, 5].map(video))
  const prompt = page.getByRole('dialog', { name: 'Select a playlist to add your 5 videos to', exact: true })

  await expect(prompt.locator('.videoSummaryTitle')).toHaveText(['Video number 1'])
  await expect(prompt.locator('.videoSummaryMore')).toHaveText('and 4 more videos')
})

test.describe('with hidden thumbnails', () => {
  test.use({ seed: { settings: { thumbnailPreference: 'hidden' } } })

  test('omits the thumbnails', async ({ page }) => {
    await showPrompt(page, [video(1), { ...video(2), author: undefined }])
    const prompt = page.getByRole('dialog', { name: 'Select a playlist to add your 2 videos to', exact: true })

    await expect(prompt.locator('.videoSummaryTitle')).toHaveText(['Video number 1', 'Video number 2'])
    await expect(prompt.locator('.videoSummaryAuthor')).toHaveText(['Channel 1'])
    await expect(prompt.locator('.videoSummaryThumbnail')).toHaveCount(0)
    await expect(prompt.locator('.videoSummaryMore')).toHaveCount(0)
  })
})

test.describe('with several playlists', () => {
  test.use({
    seed: {
      playlists: [
        { _id: 'first', playlistName: 'First', protected: false, videos: [] },
        { _id: 'second', playlistName: 'Second', protected: false, videos: [] },
      ],
    },
  })

  test('puts the playlist options beside the search outside the phone layout @scale', async ({ app, page }) => {
    await showPrompt(page, [video(1)])
    const prompt = page.getByRole('dialog', { name: 'Select a playlist to add your video to', exact: true })
    const toggle = prompt.getByRole('checkbox', { name: 'Playlists with matching videos', exact: true })
    const searchRow = prompt.locator('.controlsRow')

    await expect(searchRow.locator('.matchingVideoToggle')).toBeVisible()
    await expect(searchRow.locator('.sortSelect')).toBeVisible()
    const search = await searchRow.locator('.searchInput').boundingBox()
    const sort = await searchRow.locator('.sortSelect').boundingBox()
    expect(Math.abs((search.y + search.height / 2) - (sort.y + sort.height / 2))).toBeLessThan(4)

    await prompt.getByText('Playlists with matching videos', { exact: true }).click()
    await expect(toggle).toBeChecked()

    await setWindowSize(app, page, { width: 480, height: 800 })
    await expect(searchRow.locator('.matchingVideoToggle')).toHaveCount(0)
    await expect(prompt.locator('.promptContent .matchingVideoToggle')).toBeVisible()
    await expect(toggle).toBeChecked()
  })
})

test.describe('with long option labels', () => {
  test.use({
    seed: {
      settings: { currentLocale: 'de-DE' },
      playlists: [
        { _id: 'first', playlistName: 'First', protected: false, videos: [{ ...video(1), playlistItemId: 'item', type: 'video', timeAdded: 1 }] },
        { _id: 'second', playlistName: 'Second', protected: false, videos: [] },
      ],
    },
  })

  test('wraps the playlist options inside a narrow prompt @scale', async ({ app, page, uiScale }) => {
    // Just wider than the phone layout in CSS pixels
    await setWindowSize(app, page, { width: Math.round(610 * uiScale / 100), height: Math.round(800 * uiScale / 100) })
    await showPrompt(page, [video(1), video(2)])
    const searchRow = page.locator('.prompt .controlsRow')

    await expect(searchRow.locator('.allowDuplicateToggle')).toBeVisible()
    const row = await searchRow.boundingBox()
    for (const control of ['.matchingVideoToggle', '.allowDuplicateToggle', '.sortSelect']) {
      const box = await searchRow.locator(control).boundingBox()
      expect(box.x, control).toBeGreaterThanOrEqual(row.x - 1)
      expect(box.x + box.width, control).toBeLessThanOrEqual(row.x + row.width + 1)
    }
  })
})
