import { test, expect, goTo } from '../../helpers/app.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

for (const playlistViewType of ['grid', 'list']) {
  test.describe(`playlist ${playlistViewType} header`, { tag: '@scale' }, () => {
    test.use({
      seed: {
        settings: { playlistViewType, baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light' },
        playlists: [{
          _id: 'header-spacing',
          playlistName: 'Chill videos',
          description: '',
          protected: false,
          videos: Array.from({ length: 6 }, (_, index) => ({ videoId: `layout0000${index}`, title: `Relaxing music ${index + 1}`, author: 'Test channel', lengthSeconds: 120, playlistItemId: `layout-item-${index}`, type: 'video' })),
          lastUpdatedAt: 1700000000000,
        }],
      },
    })

    test('balances vertical gaps and centers actions', async ({ page, uiScale }) => {
      await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
      await goTo(page, 'userplaylists')
      await page.getByRole('link', { name: 'Chill videos', exact: true }).click()
      await expect(page.locator(`.playlistPage.${playlistViewType}`)).toBeVisible()
      const panel = page.locator('.playlistInfoContainer')

      for (const description of ['', 'A relaxing mix for the afternoon.']) {
        if (description) {
          await page.getByTitle('Edit Playlist Info').click()
          await page.locator('.descriptionInput input').fill(description)
          await page.getByRole('button', { name: 'Save Changes' }).click()
          await expect(page.locator('.playlistDescription')).toHaveText(description)
        }
        for (const width of [1600, 700, 375]) {
          await page.setViewportSize({ width: Math.round(width * uiScale / 100), height: Math.round(900 * uiScale / 100) })
          const layout = width <= 680 ? 'list' : playlistViewType
          await expect(page.locator(`.playlistPage.${layout}`)).toBeVisible()
          await expect(async () => {
            const gaps = await panel.evaluate(element => {
              const panel = element.getBoundingClientRect()
              const buttons = [...element.querySelector('.playlistOptions').children].map(button => button.getBoundingClientRect())
              const actions = {
                left: Math.min(...buttons.map(button => button.left)),
                right: Math.max(...buttons.map(button => button.right)),
                top: Math.min(...buttons.map(button => button.top)),
                bottom: Math.max(...buttons.map(button => button.bottom)),
              }
              const search = element.querySelector('.searchInputsRow input').getBoundingClientRect()
              const searchLabel = element.querySelector('.searchInputsRow .selectLabel').getBoundingClientRect()
              const stats = element.querySelector('.playlistStats').getBoundingClientRect()
              const description = element.querySelector('.playlistDescription')?.getBoundingClientRect()
              const contentBottom = description && description.height > 0 ? description.bottom : stats.bottom
              const separator = element.querySelector('.playlistInfoSeparator').getBoundingClientRect()
              const itemsCard = document.querySelector('.playlistItemsCard')
              const sortLabel = itemsCard.querySelector('.sortSelect .select-label').getBoundingClientRect()
              const sortField = itemsCard.querySelector('.sortSelect .select-text').getBoundingClientRect()
              const firstThumbnail = itemsCard.querySelector('.videoThumbnail').getBoundingClientRect()
              return {
                stacked: itemsCard.getBoundingClientRect().top >= panel.bottom - 1,
                sortBelowSearch: sortLabel.top - search.bottom,
                sortBelowCardTop: sortLabel.top - itemsCard.getBoundingClientRect().top,
                sortBelow: firstThumbnail.top - sortField.bottom,
                joinRadii: [
                  getComputedStyle(element).borderEndStartRadius,
                  getComputedStyle(element).borderEndEndRadius,
                  getComputedStyle(itemsCard).borderStartStartRadius,
                  getComputedStyle(itemsCard).borderStartEndRadius,
                ],
                centerDifference: Math.abs((actions.left + actions.right) / 2 - panel.x - panel.width / 2),
                searchAbove: Math.min(search.top, searchLabel.top) - actions.bottom,
                searchBelow: panel.bottom - search.bottom,
                iconsAbove: actions.top - contentBottom,
                statsBelow: separator.top - contentBottom,
                actionsAbove: actions.top - separator.bottom,
              }
            })
            expect(gaps.centerDifference, 'action icons should be horizontally centered').toBeLessThanOrEqual(1)
            const sortAbove = layout === 'list' && gaps.stacked ? gaps.sortBelowSearch : gaps.sortBelowCardTop
            expect(Math.abs(gaps.sortBelow - sortAbove), 'sort select should have equal space above and below').toBeLessThanOrEqual(1)
            if (layout === 'grid') {
              expect(gaps.searchAbove, 'grid panel gaps should be 16px').toBeCloseTo(16, 0)
              expect(Math.abs(gaps.iconsAbove - gaps.searchAbove), 'action icons should have equal space above and below').toBeLessThanOrEqual(1)
              expect(Math.abs(gaps.searchAbove - gaps.searchBelow), 'search field should have equal space above and below').toBeLessThanOrEqual(1)
            } else {
              expect(gaps.statsBelow, 'list panel gaps should be 16px').toBeCloseTo(16, 0)
              expect(Math.abs(gaps.actionsAbove - gaps.statsBelow), 'space above actions should match space below metadata').toBeLessThanOrEqual(1)
              expect(Math.abs(gaps.searchAbove - gaps.statsBelow), 'space below actions should match space below metadata').toBeLessThanOrEqual(1)
              expect(gaps.stacked, 'info panel should stack above the videos up to 850px').toBe(width <= 850)
              if (gaps.stacked) {
                expect(gaps.searchBelow, 'stacked panel should end 16px below the search field').toBeCloseTo(16, 0)
                expect(Math.abs(gaps.sortBelowSearch - gaps.searchAbove), 'search field should have equal space above and below').toBeLessThanOrEqual(1)
                expect(gaps.joinRadii, 'stacked cards should not round the corners where they meet').toEqual(['0px', '0px', '0px', '0px'])
              }
            }
          }).toPass({ timeout: 2000 })
        }

        if (description) continue
        await page.setViewportSize({ width: Math.round(1600 * uiScale / 100), height: Math.round(900 * uiScale / 100) })
        await expectImagesLoaded(page.locator('.playlistPage img:visible'))
        for (const theme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme: theme })
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
          // Let Playwright settle element bounds before calculating the crop.
          await panel.screenshot({ animations: 'disabled' })
          const clip = await panel.evaluate(element => {
            const panel = element.getBoundingClientRect()
            const stats = element.querySelector('.playlistStats').getBoundingClientRect()
            const search = element.querySelector('.searchInputsRow input').getBoundingClientRect()
            const top = stats.top - 8
            return { x: panel.x, y: top, width: panel.width, height: Math.min(panel.bottom, search.bottom + 30) - top }
          })
          await page.screenshot({ path: test.info().outputPath(`playlist-${playlistViewType}-${theme}.png`), clip })
        }
      }
    })
  })
}

test.describe('stacked playlist without a sort select', { tag: '@scale' }, () => {
  test.use({
    seed: {
      settings: { playlistViewType: 'list' },
      playlists: [{
        _id: 'single-video',
        playlistName: 'Single video',
        description: '',
        protected: false,
        videos: [{ videoId: 'layout00000', title: 'Only video', author: 'Test channel', lengthSeconds: 120, playlistItemId: 'single-item', type: 'video' }],
        lastUpdatedAt: 1700000000000,
      }],
    },
  })

  test('keeps the items card top inset', async ({ page, uiScale }) => {
    await page.setViewportSize({ width: Math.round(375 * uiScale / 100), height: Math.round(900 * uiScale / 100) })
    await goTo(page, 'userplaylists')
    await page.getByRole('link', { name: 'Single video', exact: true }).click()
    await expect(page.locator('.playlistItem')).toHaveCount(1)
    await expect(page.locator('.playlistItemsCard .sortSelect')).toHaveCount(0)
    await expect(page.locator('.playlistItemsCard')).toHaveCSS('padding-top', '10px')
  })
})
