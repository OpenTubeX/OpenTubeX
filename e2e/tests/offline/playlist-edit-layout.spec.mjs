import { test, expect, goTo } from '../../helpers/app.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

test.use({
  seed: {
    settings: { baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light' },
    playlists: [{
      _id: 'edit-layout',
      playlistName: 'Weekend walks',
      description: 'Videos for a quiet weekend',
      protected: false,
      createdAt: 1700000000000,
      lastUpdatedAt: 1700000000000,
      videos: ['a', 'b'].map(id => ({ videoId: `editlayout${id}`, playlistItemId: `edit-layout-${id}`, title: 'Mountain walk', author: 'Test channel', lengthSeconds: 120, type: 'video' })),
    }],
  },
})

async function resize(app, page, width, uiScale, height = 900) {
  await app.electronApp.evaluate(({ BrowserWindow }, { width, height, uiScale }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setMinimumSize(0, 0)
    window.setContentSize(Math.round(width * uiScale / 100), Math.round(height * uiScale / 100))
  }, { width, height, uiScale })
  await expect.poll(() => page.evaluate(width => Math.abs(innerWidth - width), width)).toBeLessThanOrEqual(1)
}

for (const playlistViewType of ['grid']) {
  test(`edit form uses the available width in the ${playlistViewType} layout`, { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.evaluate(view => window.$store.dispatch('updatePlaylistViewType', view), playlistViewType)
    await goTo(page, 'userplaylists')
    await page.getByRole('link', { name: 'Weekend walks', exact: true }).click()
    await page.getByTitle('Edit Playlist Info').click()
    const form = page.locator('.editForm')

    for (const width of [1600, 1000, 375]) {
      await resize(app, page, width, uiScale)
      await expect(async () => {
        const layout = await form.evaluate(element => {
          const bounds = node => element.querySelector(node).getBoundingClientRect()
          const fields = bounds('.editFields')
          const thumbnail = bounds('.playlistThumbnailPicker')
          const icon = bounds('.quickBookmarkIconPicker')
          const toggles = [...element.querySelectorAll('.editToggles .switch-ctn')].map(toggle => toggle.getBoundingClientRect())
          const form = element.getBoundingClientRect()
          return {
            fields,
            thumbnail,
            icon,
            toggles,
            overflow: Math.max(...[fields, thumbnail, icon].map(box => box.right)) - form.right,
            beforeForm: Math.min(...[fields, thumbnail, icon].map(box => box.left)) - form.left,
          }
        })
        expect(layout.overflow).toBeLessThanOrEqual(1)
        expect(layout.beforeForm).toBeGreaterThanOrEqual(-1)
        const sidebar = playlistViewType === 'list' || width <= 680
        if (!sidebar && width === 1600) {
          // Fields and both pickers share one row
          expect(Math.abs(layout.thumbnail.top - layout.fields.top)).toBeLessThanOrEqual(8)
          expect(Math.abs(layout.icon.top - layout.fields.top)).toBeLessThanOrEqual(8)
          expect(layout.thumbnail.left).toBeGreaterThan(layout.fields.right)
          expect(layout.icon.left).toBeGreaterThan(layout.thumbnail.right)
          expect(Math.abs(layout.toggles[0].top - layout.toggles[1].top)).toBeLessThanOrEqual(1)
        } else if (!sidebar && width === 1000) {
          // The pickers wrap below the fields side by side
          expect(layout.thumbnail.top).toBeGreaterThan(layout.fields.bottom)
          expect(Math.abs(layout.icon.top - layout.thumbnail.top)).toBeLessThanOrEqual(1)
        } else if (width === 375) {
          expect(layout.thumbnail.top).toBeGreaterThan(layout.fields.bottom)
          expect(layout.icon.top).toBeGreaterThan(layout.thumbnail.bottom)
        }
      }).toPass({ timeout: 2000 })
    }

    // Tall enough for the stacked list panel to fit below the top bar
    await resize(app, page, 1600, uiScale, 1100)
    await page.evaluate(() => window.scrollTo(0, 0))
    // The floating name label stays inside the panel
    const labelInset = await page.locator('.playlistInfoContainer').evaluate(element => {
      return element.querySelector('.editFields .selectLabel').getBoundingClientRect().top - element.getBoundingClientRect().top
    })
    expect(labelInset).toBeGreaterThanOrEqual(0)
    await expectImagesLoaded(form.locator('img:not(.retryImagePlaceholder)'))
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
      await page.locator('.playlistInfoContainer').screenshot({ path: testInfo.outputPath(`playlist-edit-${playlistViewType}-${colorScheme}.png`), animations: 'disabled' })
    }

    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(form).toHaveCount(0)
    await expect(page.locator('.playlistDescription')).toHaveText('Videos for a quiet weekend')
  })
}
