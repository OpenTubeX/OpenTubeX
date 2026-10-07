import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

const description = 'A playlist with a long description that should leave plenty of room for its videos. '.repeat(80)

for (const uiScale of [100, 125]) {
  test.describe(`playlist description at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: { uiScale, playlistViewType: 'grid', alwaysShowScrollbars: true, baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light' },
        playlists: [{
          _id: 'description-layout',
          playlistName: 'Playlist with a long description',
          description,
          protected: false,
          videos: Array.from({ length: 6 }, (_, index) => ({
            videoId: `layout0000${index}`,
            title: `Playlist video ${index + 1}`,
            author: 'Test channel',
            lengthSeconds: 120,
            playlistItemId: `layout-item-${index}`,
            type: 'video'
          })),
          lastUpdatedAt: Date.now()
        }]
      }
    })

    test('keeps the grid header compact and the full description scrollable', async ({ app, page, attachScreenshot }) => {
      await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
      await goTo(page, 'userplaylists')
      await page.getByRole('link', { name: 'Playlist with a long description', exact: true }).click()
      const scroller = page.locator('.playlistDescription')
      await expect(scroller).toHaveText(description.trim())
      await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport', /overflowYScroll/)

      // Narrow landscape uses list layout and retains its existing description cap.
      for (const { maxHeightFraction = 0.1, ...size } of [{ width: 1440, height: 950 }, { width: 375, height: 812 }, { width: 812, height: 375, maxHeightFraction: 0.2 }, { width: 1440, height: 900 }]) {
        // Start at the bottom before changing the scroll range or wrapping.
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        await setWindowSize(app, page, size)
        await expect(async () => {
          const geometry = await scroller.evaluate(element => ({
            height: element.getBoundingClientRect().height,
            viewportHeight: window.innerHeight,
            scrollTop: element.scrollTop,
            range: element.scrollHeight - element.clientHeight,
            scrollbarHidden: element.querySelector('.os-scrollbar-vertical').classList.contains('os-scrollbar-unusable')
          }))
          expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight * maxHeightFraction + 1)
          expect(geometry.range).toBeGreaterThan(0)
          expect(geometry.scrollTop).toBeGreaterThanOrEqual(0)
          expect(geometry.scrollTop).toBeLessThanOrEqual(geometry.range + 1)
          expect(geometry.scrollbarHidden).toBe(false)
        }).toPass({ timeout: 15_000 })
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => scroller.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1)
      }

      await scroller.evaluate(element => { element.scrollTop = 0 })
      await expectImagesLoaded(page.locator('.playlistItemsCard .thumbnailImage'))
      for (const theme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme: theme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
        await attachScreenshot(`compact playlist description ${theme}`)
      }

      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await page.getByTitle('Edit Playlist Info').click()
      await page.locator('.descriptionInput input').fill('Short description')
      await page.getByTitle('Save Changes').click()
      await expect(scroller).toHaveText('Short description')
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
      await expect(scroller.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
    })
  })
}
