import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

const seed = {
  settings: { baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light' },
  playlists: ['Favorites', 'Watch Later'].map((playlistName, index) => ({
    _id: `controls-${index}`,
    playlistName,
    protected: false,
    videos: [{ videoId: `layout0000${index}`, title: 'Relaxing music', author: 'Test channel', lengthSeconds: 120, playlistItemId: `layout-item-${index}`, type: 'video' }],
    lastUpdatedAt: 1700000000000,
  })),
}

test.use({ seed })

test('playlist controls match History spacing and align the switch with sorting', { tag: '@scale' }, async ({ app, page, uiScale }) => {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await goTo(page, 'userplaylists')
  await expect(page.getByRole('link', { name: 'Watch Later', exact: true })).toBeVisible()

  for (const width of [1500, 732, 375, 320]) {
    await setWindowSize(app, page, { width, height: width === 320 ? 820 : width === 375 ? 850 : width === 732 ? 550 : 950 })
    await expect(async () => {
      const geometry = await page.locator('.optionsRow').evaluate(element => {
        const card = element.closest('.card')
        const headingBottom = Math.max(...[...card.querySelector('.headingRow').children].map(child => child.getBoundingClientRect().bottom))
        const search = card.querySelector('.searchInputsRow input').getBoundingClientRect()
        const searchLabel = card.querySelector('.searchInputsRow .selectLabel').getBoundingClientRect()
        const toggleText = element.querySelector('.switch-label-text')
        const text = toggleText.getBoundingClientRect()
        const trackHeight = Number.parseFloat(getComputedStyle(toggleText, '::before').height)
        const toggleTop = Math.min(text.top, text.top + (text.height - trackHeight) / 2)
        const toggleBottom = Math.max(text.bottom, text.top + (text.height + trackHeight) / 2)
        const sort = element.querySelector('.select-text').getBoundingClientRect()
        const sortLabel = element.querySelector('.select-label').getBoundingClientRect()
        const sortTop = Math.min(sort.top, sortLabel.top)
        const results = card.querySelector('.autoGrid').getBoundingClientRect()
        const stacked = getComputedStyle(element).gridTemplateRows.split(' ').length === 2
        return {
          searchAbove: Math.min(search.top, searchLabel.top) - headingBottom,
          gaps: stacked
            ? [toggleTop - search.bottom, sortTop - toggleBottom, results.top - sort.bottom]
            : [Math.min(toggleTop, sortTop) - search.bottom, results.top - Math.max(sort.bottom, toggleBottom)],
          stacked,
          centerDifference: Math.abs((text.top + text.bottom) / 2 - (sortTop + sort.bottom) / 2),
        }
      })
      expect(geometry.searchAbove).toBeCloseTo(20, 0)
      expect(geometry.gaps).toEqual(Array(geometry.stacked ? 3 : 2).fill(expect.closeTo(20, 0)))
      if (!geometry.stacked) expect(geometry.centerDifference).toBeLessThanOrEqual(1)
    }).toPass({ timeout: 2000 })
    if (width * 100 / uiScale <= 680) {
      const touchTarget = await page.locator('.optionsRow .switch-label').boundingBox()
      // Electron zoom can introduce tiny fractions in CSS-pixel bounds.
      expect(touchTarget.height).toBeGreaterThanOrEqual(48 - 0.01)
    }
  }

  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
  await setWindowSize(app, page, { width: 1500, height: 950 })
  await expectImagesLoaded(page.locator('.card img:visible'))
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    await page.locator('.card').screenshot({ path: test.info().outputPath(`playlist-controls-${theme}.png`) })
  }
})

test.describe('single playlist', () => {
  test.use({ seed: { ...seed, playlists: seed.playlists.slice(0, 1) } })

  test('keeps a gap below the heading when search controls are hidden', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await expect(page.getByRole('link', { name: 'Favorites', exact: true })).toBeVisible()
    await expect(page.locator('.searchInputsRow')).toHaveCount(0)
    await expect(page.locator('.optionsRow')).toHaveCount(0)
    await expect.poll(() => page.locator('.headingRow').evaluate(element => {
      const headingBottom = Math.max(...[...element.children].map(child => child.getBoundingClientRect().bottom))
      const results = element.closest('.card').querySelector('.autoGrid').getBoundingClientRect()
      return results.top - headingBottom
    })).toBeCloseTo(20, 0)
  })
})
