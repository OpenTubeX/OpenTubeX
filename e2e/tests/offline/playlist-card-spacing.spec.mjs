import { test, expect, goTo } from '../../helpers/app.mjs'

const videos = ['Short title', 'A longer playlist video title that wraps across several lines on a narrow phone', 'Another short title']
  .map((title, index) => ({
    videoId: String(index).padStart(11, '0'),
    playlistItemId: `spacing-${index}`,
    title,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    lengthSeconds: 120,
    published: 1700000000000,
    timeAdded: 1700000000000 + index,
    type: 'video'
  }))

test.use({
  seed: {
    settings: { playlistViewType: 'list', baseTheme: 'dark' },
    playlists: [{
      _id: 'card-spacing',
      playlistName: 'Playlist card spacing',
      protected: false,
      description: '',
      videos,
      createdAt: 1700000000000,
      lastUpdatedAt: 1700000000000
    }],
    history: videos.slice(0, 2).map(video => ({
      ...video,
      _id: video.videoId,
      isWatched: true,
      watchProgress: 120,
      timeWatched: 1700000000000
    }))
  }
})

test('mobile playlist cards have compact padding and space between rows', async ({ app, page, attachScreenshot }) => {
  await goTo(page, 'userplaylists')
  await page.getByRole('link', { name: 'Playlist card spacing', exact: true }).click()
  const cards = page.locator('.playlistItems .ft-list-video')
  await expect(cards).toHaveCount(3)
  await expect(page.locator('.playlistItems .ft-list-video.watched')).toHaveCount(2)

  for (const scale of [1, 1.25]) {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale)
    }, scale)
    for (const viewport of [{ width: 375, height: 812 }, { width: 461, height: 1026 }, { width: 812, height: 375 }]) {
      await page.setViewportSize(viewport)
      for (const card of await cards.all()) {
        await expect(card).toHaveCSS('padding-block', '4px')
      }
      const layout = await cards.evaluateAll(elements => elements.map(element => {
        const bounds = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        const info = element.querySelector('.info').getBoundingClientRect()
        const contentBottom = Math.max(...[...element.querySelectorAll('.videoThumbnail, .title, .infoLine')]
          .map(content => content.getBoundingClientRect().bottom))
        return {
          top: bounds.top,
          bottom: bounds.bottom,
          paddingTop: parseFloat(style.paddingTop),
          paddingBottom: parseFloat(style.paddingBottom),
          contentFits: info.top >= bounds.top && info.bottom <= bounds.bottom + 1,
          bottomInset: bounds.bottom - contentBottom,
        }
      }))
      for (const [index, card] of layout.entries()) {
        expect(card.paddingTop).toBeLessThanOrEqual(4)
        expect(card.paddingBottom).toBeLessThanOrEqual(4)
        expect(card.contentFits).toBe(true)
        expect(card.bottomInset).toBeLessThanOrEqual(5)
        if (index > 0) {
          expect(card.top - layout[index - 1].bottom).toBeGreaterThanOrEqual(7.5)
        }
      }
      if (scale === 1 && viewport.width === 461) {
        await page.locator('.playlistItems').evaluate(element => element.scrollIntoView({ block: 'start' }))
        await attachScreenshot('mobile playlist card spacing')
      }
    }
  }
})
