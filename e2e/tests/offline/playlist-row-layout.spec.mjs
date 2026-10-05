import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

const longTitle = 'Spider-Man Brand New Day Breakdown! Every Easter Egg and Detail You Missed in the Entire Timeline'
const fixtureTitles = [longTitle, 'Short title', 'A'.repeat(160)]

async function setThumbnailSize(page, size) {
  await page.locator('.profileTrigger').click()
  const slider = page.locator('.thumbnailSizeSlider .input')
  await expect(slider).toBeVisible()
  await slider.evaluate((element, value) => {
    element.value = String(value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, size)
  await page.locator('.profileTrigger').click()
  await expect(slider).toBeHidden()
}

for (const [uiScale, userPlaylistSortOrder] of [[100, 'date_added_descending'], [125, 'date_added_descending'], [100, 'custom'], [125, 'custom']]) {
  test.describe(`playlist rows at ${uiScale}% UI scale with ${userPlaylistSortOrder} sorting`, () => {
    test.use({
      seed: {
        settings: { uiScale, userPlaylistSortOrder, playlistViewType: 'list', quickBookmarkTargetPlaylistId: 'bookmarks', baseTheme: uiScale === 100 ? 'dark' : 'light' },
        playlists: [{
          _id: 'row-layout',
          playlistName: 'Playlist row layout',
          protected: false,
          videos: fixtureTitles.map((title, index) => ({
            videoId: `layout0000${index}`,
            title,
            author: 'A channel with a very long name that should not crowd the video title',
            authorId: 'UC-test-channel-id',
            lengthSeconds: 120,
            viewCount: 12000,
            published: Date.now() - 86_400_000,
            playlistItemId: `layout-item-${index}`,
            type: 'video'
          })),
          lastUpdatedAt: Date.now()
        }, {
          _id: 'bookmarks',
          playlistName: 'Bookmarks',
          protected: false,
          videos: [],
          lastUpdatedAt: Date.now()
        }]
      }
    })

    test('keeps long titles and metadata balanced beside thumbnails', async ({ app, page, attachScreenshot }) => {
      await goTo(page, 'userplaylists')
      await page.getByRole('link', { name: 'Playlist row layout', exact: true }).click()
      const rows = page.locator('.playlistItem .ft-list-video')
      await expect(rows).toHaveCount(3)

      for (const size of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1440, height: 900 }]) {
        await setWindowSize(app, page, size)
        for (const [index, row] of (await rows.all()).entries()) {
          const title = row.locator('.title')
          // Clamp only the visible text; retain the full accessible link name.
          await expect(title).toHaveAccessibleName(fixtureTitles[index])
          // Wait for every part of the row to reflow after a responsive layout change.
          await expect(async () => {
            const geometry = await row.evaluate(element => {
              const title = element.querySelector('.title')
              const thumbnail = element.querySelector('.videoThumbnail')
              const info = element.querySelector('.infoLine')
              const numberedRow = element.closest('.playlistItem').getBoundingClientRect()
              const indexParts = [...element.closest('.playlistItem').querySelectorAll('.videoIndex, .grabBar')]
                .filter(part => part.getClientRects().length > 0)
                .map(part => part.getBoundingClientRect())
              const indexCenter = (Math.min(...indexParts.map(part => part.top)) + Math.max(...indexParts.map(part => part.bottom))) / 2
              const thumbnailRect = thumbnail.getBoundingClientRect()
              const thumbnailCenter = thumbnailRect.top + thumbnailRect.height / 2
              const contentCenter = (title.getBoundingClientRect().top + info.getBoundingClientRect().bottom) / 2
              const style = getComputedStyle(title)
              return {
                fontSize: parseFloat(style.fontSize),
                titleHeight: title.getBoundingClientRect().height,
                lineHeight: parseFloat(style.lineHeight),
                contentCenterDifference: Math.abs(contentCenter - thumbnailCenter),
                metadataFontSize: parseFloat(getComputedStyle(info).fontSize),
                overflow: Math.max(element.getBoundingClientRect().right, title.getBoundingClientRect().right, info.getBoundingClientRect().right) - document.documentElement.clientWidth,
                thumbnailRatio: thumbnail.getBoundingClientRect().width / thumbnail.getBoundingClientRect().height,
                indexCenterDifference: Math.abs(indexCenter - thumbnailCenter),
                rowCenterDifference: Math.abs(thumbnailCenter - numberedRow.top - numberedRow.height / 2)
              }
            })
            expect(geometry.fontSize).toBeLessThanOrEqual(16)
            expect(geometry.titleHeight).toBeLessThanOrEqual(geometry.lineHeight * 2 + 1)
            expect(geometry.contentCenterDifference).toBeLessThanOrEqual(1)
            expect(geometry.metadataFontSize).toBeLessThan(geometry.fontSize)
            expect(geometry.overflow).toBeLessThanOrEqual(1)
            expect(geometry.thumbnailRatio).toBeCloseTo(16 / 9, 1)
            expect(geometry.indexCenterDifference).toBeLessThanOrEqual(2)
            expect(geometry.rowCenterDifference).toBeLessThanOrEqual(1)
          }).toPass({ timeout: 15_000 })
        }
        await attachScreenshot(`playlist rows ${size.width}px`)
      }

      const thumbnail = rows.first().locator('.videoThumbnail')
      const originalWidth = (await thumbnail.boundingBox()).width
      await setThumbnailSize(page, 110)
      await expect.poll(async () => (await thumbnail.boundingBox()).width).toBeGreaterThan(originalWidth)
    })

    if (userPlaylistSortOrder === 'custom') {
      test('keeps all thumbnail actions inside small thumbnails', async ({ app, page }) => {
        await setWindowSize(app, page, { width: 1440, height: 812 })
        await goTo(page, 'userplaylists')
        await page.getByRole('link', { name: 'Playlist row layout', exact: true }).click()
        await setThumbnailSize(page, 60)
        const thumbnail = page.locator('.playlistItem .videoThumbnail').nth(1)
        await thumbnail.hover()
        const buttons = thumbnail.locator('.playlistIcons button')
        await expect(buttons).toHaveCount(5)
        await expect(async () => {
          const bounds = await thumbnail.boundingBox()
          for (const button of await buttons.all()) {
            await expect(button).toBeVisible()
            const action = await button.boundingBox()
            expect(action.x).toBeGreaterThanOrEqual(bounds.x - 1)
            expect(action.y).toBeGreaterThanOrEqual(bounds.y - 1)
            expect(action.x + action.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
            expect(action.y + action.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1)
          }
        }).toPass({ timeout: 15_000 })
      })
    }
  })
}
