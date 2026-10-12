import { test, expect, goTo } from '../../helpers/app.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

for (const uiScale of [100, 125]) {
  for (const playlistViewType of ['grid', 'list']) {
    test.describe(`playlist ${playlistViewType} header at ${uiScale}% UI scale`, () => {
      test.use({
        seed: {
          settings: { uiScale, playlistViewType, baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light' },
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

      test('balances vertical gaps and centers actions', async ({ page }) => {
        await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
        await goTo(page, 'userplaylists')
        await page.getByRole('link', { name: 'Chill videos', exact: true }).click()
        await expect(page.locator(`.playlistPage.${playlistViewType}`)).toBeVisible()
        const panel = page.locator('.playlistInfoContainer')

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
              const separator = element.querySelector('.playlistInfoSeparator').getBoundingClientRect()
              return {
                centerDifference: Math.abs((actions.left + actions.right) / 2 - panel.x - panel.width / 2),
                searchAbove: Math.min(search.top, searchLabel.top) - actions.bottom,
                searchBelow: panel.bottom - search.bottom,
                statsBelow: separator.top - stats.bottom,
                actionsAbove: actions.top - separator.bottom,
              }
            })
            expect(gaps.centerDifference, 'action icons should be horizontally centered').toBeLessThanOrEqual(1)
            if (layout === 'grid') {
              expect(Math.abs(gaps.searchAbove - gaps.searchBelow), 'search field should have equal space above and below').toBeLessThanOrEqual(1)
            } else {
              expect(gaps.statsBelow).toBeGreaterThan(0)
              expect(Math.abs(gaps.actionsAbove - gaps.statsBelow), 'space above actions should match space below metadata').toBeLessThanOrEqual(1)
              expect(Math.abs(gaps.searchAbove - gaps.statsBelow), 'space below actions should match space below metadata').toBeLessThanOrEqual(1)
            }
          }).toPass({ timeout: 2000 })
        }

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
      })
    })
  }
}
