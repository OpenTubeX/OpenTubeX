import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

const longTitle = 'Spider-Man Brand New Day Breakdown! Every Easter Egg and Detail You Missed in the Entire Timeline'
const fixtureTitles = [longTitle, 'Short title', 'A'.repeat(160)]

async function setThumbnailSize(page, size) {
  await page.locator('.profileTrigger').click()
  const slider = page.locator('.thumbnailSizeSlider .input')
  await expect(slider).toBeVisible()
  await slider.press('Home')
  const step = Number(await slider.getAttribute('step'))
  for (let value = Number(await slider.getAttribute('min')); value < size; value += step) {
    await slider.press('ArrowRight')
  }
  await expect(slider).toHaveValue(String(size))
  await page.locator('.profileTrigger').click()
  await expect(slider).toBeHidden()
}

for (const [uiScale, userPlaylistSortOrder] of [[100, 'date_added_descending'], [125, 'date_added_descending'], [100, 'custom'], [125, 'custom']]) {
  test.describe(`playlist rows at ${uiScale}% UI scale with ${userPlaylistSortOrder} sorting`, () => {
    test.use({
      seed: {
        settings: { uiScale, userPlaylistSortOrder, playlistViewType: 'list', quickBookmarkTargetPlaylistId: 'bookmarks', extraThumbnailAction: 'copyYoutube', externalPlayer: 'mpv', baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light' },
        history: [{
          _id: 'layout00001',
          videoId: 'layout00001',
          title: fixtureTitles[1],
          author: 'Test channel',
          authorId: 'UC-test-channel-id',
          isWatched: true,
          watchProgress: 120,
          timeWatched: Date.now()
        }],
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
            isUpcoming: index === 1,
            premiereTimestamp: index === 1 ? Math.floor(Date.now() / 1000) + 3600 : 0,
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
      let previousWidth = 0
      for (const size of [60, 70, 80, 90, 100, 110, 120, 130]) {
        await setThumbnailSize(page, size)
        await expect.poll(async () => (await thumbnail.boundingBox()).width).toBeGreaterThan(previousWidth)
        previousWidth = (await thumbnail.boundingBox()).width
      }
    })

    if (userPlaylistSortOrder === 'custom') {
      test('keeps all thumbnail actions inside small thumbnails', async ({ app, page }) => {
        await goTo(page, 'userplaylists')
        await page.getByRole('link', { name: 'Playlist row layout', exact: true }).click()
        await setThumbnailSize(page, 60)
        const thumbnail = page.locator('.playlistItem .videoThumbnail').nth(1)
        await expect(thumbnail.locator('.videoWatched')).toBeVisible()
        // Reuse the scoped badge fixture pattern from the watch-playlist tests.
        await thumbnail.evaluate(element => {
          const label = element.querySelector('.videoDuration').cloneNode(false)
          label.className = 'sponsorBlockVideoLabel'
          label.textContent = 'Self-Promotion'
          element.append(label)
        })
        const badges = thumbnail.locator('.videoDuration, .videoWatched, .sponsorBlockVideoLabel')
        await expect(badges).toHaveCount(3)
        const actions = thumbnail.locator('.playlistIcons')
        const buttons = actions.locator('button')
        for (const theme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme: theme })
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
          for (const { width, height, mobile } of [
            { width: 1440, height: 950, mobile: false },
            { width: 1000, height: 850, mobile: false },
            { width: 812, height: 375, mobile: true },
            { width: 375, height: 812, mobile: true }
          ]) {
            await setWindowSize(app, page, { width, height })
            if (mobile) {
              await expect(actions).toHaveClass(/mobileThumbnailActions/)
              await expect(actions).toBeHidden()
              continue
            }
            await page.locator('.sortSelect').hover()
            for (const badge of await badges.all()) await expect(badge).toBeVisible()
            await expect(actions).toHaveCSS('opacity', '0')
            await thumbnail.hover()
            await expect(buttons).toHaveCount(7)
            for (const badge of await badges.all()) await expect(badge).toBeHidden()
            await expect(async () => {
              await thumbnail.hover()
              await expect(actions).toHaveCSS('opacity', '1')
              for (const badge of await badges.all()) await expect(badge).toBeHidden()
              const bounds = await thumbnail.boundingBox()
              for (const button of await buttons.all()) {
                await expect(button).toBeVisible()
                const action = await button.boundingBox()
                // Electron zoom can produce fractional CSS-pixel bounds.
                expect(action.width).toBeGreaterThanOrEqual(24 - 0.01)
                expect(action.height).toBeGreaterThanOrEqual(24 - 0.01)
                expect(action.x).toBeGreaterThanOrEqual(bounds.x - 1)
                expect(action.y).toBeGreaterThanOrEqual(bounds.y - 1)
                expect(action.x + action.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
                expect(action.y + action.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1)
                const externalPlayer = await thumbnail.locator('.externalPlayerIcon').boundingBox()
                const separateFromExternalPlayer = action.x + action.width <= externalPlayer.x + 1 ||
                  externalPlayer.x + externalPlayer.width <= action.x + 1 ||
                  action.y + action.height <= externalPlayer.y + 1 ||
                  externalPlayer.y + externalPlayer.height <= action.y + 1
                expect(separateFromExternalPlayer).toBe(true)
              }
            }).toPass({ timeout: 15_000 })
            await page.locator('.playlistItem .ft-list-video').nth(1).locator('.title').focus()
            await page.locator('.sortSelect').hover()
            await expect(actions).toHaveCSS('opacity', '1')
            for (const badge of await badges.all()) await expect(badge).toBeHidden()
            await page.locator('.profileTrigger').focus()
            for (const badge of await badges.all()) await expect(badge).toBeVisible()
          }
        }
      })
    }
  })
}
