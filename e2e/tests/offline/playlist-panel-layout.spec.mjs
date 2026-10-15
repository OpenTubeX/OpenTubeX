import { test, expect, goTo } from '../../helpers/app.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

const videos = Array.from({ length: 6 }, (_, index) => ({
  type: 'video',
  title: `Playlist video ${index + 1}`,
  videoId: `layout0000${index}`,
  author: 'Playlist channel',
  authorId: 'UCplaylistchannel',
  authorUrl: '/channel/UCplaylistchannel',
  videoThumbnails: [],
  index,
  lengthSeconds: 120,
}))

for (const uiScale of [100, 125]) {
  for (const playlistViewType of ['grid', 'list']) {
    test.describe(`playlist ${playlistViewType} panel at ${uiScale}% UI scale`, () => {
      test.use({
        seed: {
          settings: {
            uiScale,
            playlistViewType,
            backendPreference: 'invidious',
            backendFallback: false,
            enableSearchSuggestions: false,
            defaultInvidiousInstance: 'https://invidious.test',
            generalAutoLoadMorePaginatedItemsEnabled: false,
            baseTheme: 'system',
            systemDarkTheme: 'dark',
            systemLightTheme: 'light',
          },
          history: videos.slice(1, 4).map(video => ({
            ...video,
            _id: video.videoId,
            isWatched: true,
            watchProgress: 120,
            timeWatched: 1700000000000,
          })),
        },
      })

      test('respects roundness and centers grid actions with and without a channel', async ({ page, attachScreenshot }) => {
        await page.route('https://invidious.test/vi/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
        await page.route('https://invidious.test/ggpht/**', route => fulfillVisualFixture(route, 'avatar'))
        await page.route(/\/api\/v1\/playlists\/panel-layout\?/, route => route.fulfill({
          json: {
            title: 'Playlist layout',
            playlistId: 'panel-layout',
            author: 'Playlist channel',
            authorId: 'UCplaylistchannel',
            authorThumbnails: [{ url: 'https://yt3.ggpht.com/test=s76' }],
            description: '',
            videoCount: videos.length,
            viewCount: 1000,
            updated: 1700000000,
            videos,
          },
        }))
        const tab = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/playlist/panel-layout', makeActive: false }))
        await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
        await expect(page.locator(`.playlistPage.${playlistViewType}`)).toBeVisible()
        await expect(page.locator('.playlistChannel')).toBeVisible()
        const panel = page.locator('.playlistInfoContainer')

        for (const pack of ['material', 'remix']) {
          await page.evaluate(value => window.$store.dispatch('updateIconPack', value), pack)
          const video = page.locator('.playlistItemsCard .ft-list-video').filter({
            has: page.getByRole('link', { name: 'Playlist video 2', exact: true }),
          })
          const infoLine = video.locator('.infoLine')
          const avatar = infoLine.locator('.channelAvatar')
          await expect(avatar).toBeVisible()
          await page.mouse.move(0, 0)
          const bounds = await avatar.boundingBox()
          expect(bounds, 'visible avatar should have screenshot bounds').not.toBeNull()
          const clip = { x: bounds.x - 3, y: bounds.y - 3, width: bounds.width + 6, height: bounds.height + 6 }
          const actual = await page.screenshot({ clip, animations: 'disabled' })
          const previousOverflow = await infoLine.evaluate(element => {
            const previous = element.style.overflowX
            element.style.overflowX = 'visible'
            return previous
          })
          const unclipped = await page.screenshot({ clip, animations: 'disabled' })
          await infoLine.evaluate((element, previous) => { element.style.overflowX = previous }, previousOverflow)
          expect(actual.equals(unclipped), `${pack} avatar should look the same without metadata clipping`).toBe(true)
        }
        await page.evaluate(() => window.$store.dispatch('updateIconPack', 'material'))

        for (const width of [1440, 700, 375]) {
          // Electron window sizes are physical pixels; preserve the intended CSS viewport at each zoom.
          await page.setViewportSize({ width: Math.round(width * uiScale / 100), height: Math.round(900 * uiScale / 100) })
          const layout = width <= 680 ? 'list' : playlistViewType
          await expect(page.locator(`.playlistPage.${layout}`)).toBeVisible()
          if (layout === 'grid') {
            const author = page.locator('.playlistChannel .channelName')
            const originalName = await author.textContent()
            await author.evaluate(element => { element.textContent = 'A playlist channel with a very long author name '.repeat(6) })
            const fits = await author.evaluate(element => {
              const title = element.getBoundingClientRect()
              const row = element.closest('.playlistChannel').getBoundingClientRect()
              return title.top >= row.top - 1 && title.bottom <= row.bottom + 1
            })
            await author.evaluate((element, text) => { element.textContent = text }, originalName)
            expect(fits, 'long author names should fit inside the grid action row').toBe(true)
          }
          for (const roundness of [100, 0, 200]) {
            await page.evaluate(value => window.$store.dispatch('updateUiRoundness', value), roundness)
            await expect(panel).toHaveCSS('border-radius', `${12 * roundness / 100}px`, { timeout: 2000 })
            if (layout === 'grid') {
              await expect(panel).toHaveCSS('box-shadow', 'none')
              await expect(async () => {
                const geometry = await panel.evaluate(element => {
                  const panel = element.getBoundingClientRect()
                  const actions = element.querySelector('.playlistOptions').getBoundingClientRect()
                  const channel = element.querySelector('.playlistChannel').getBoundingClientRect()
                  return {
                    centerDifference: Math.abs(actions.x + actions.width / 2 - panel.x - panel.width / 2),
                    separate: actions.left >= channel.right - 1 || actions.top >= channel.bottom - 1,
                  }
                })
                expect(geometry.centerDifference).toBeLessThanOrEqual(1)
                expect(geometry.separate).toBe(true)
              }).toPass({ timeout: 2000 })
            }
          }
        }

        await page.setViewportSize({ width: Math.round(1440 * uiScale / 100), height: Math.round(900 * uiScale / 100) })
        await page.evaluate(() => window.$store.dispatch('updateUiRoundness', 100))
        await expectImagesLoaded(page.locator('.playlistPage img:visible'))
        for (const theme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme: theme })
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
          await attachScreenshot(`playlist ${playlistViewType} ${theme}`)
          if (uiScale === 100) {
            const bounds = await page.locator('.playlistPage').boundingBox()
            expect(bounds, 'visible playlist should have screenshot bounds').not.toBeNull()
            await page.screenshot({
              path: test.info().outputPath(`playlist-${playlistViewType}-${theme}.png`),
              clip: { x: bounds.x, y: bounds.y, width: bounds.width, height: Math.min(bounds.height, 600) },
            })
          }
        }

        if (playlistViewType === 'grid') {
          await page.evaluate(async () => {
            const store = window.$store
            await store.dispatch('addPlaylist', { playlistName: 'Local playlist layout', description: '', videos: [] })
          })
          await goTo(page, 'userplaylists')
          await page.getByRole('link', { name: 'Local playlist layout', exact: true }).click()
          await expect(page.locator('.playlistChannel')).toHaveCount(0)
          const geometry = await panel.evaluate(element => {
            const panel = element.getBoundingClientRect()
            const actions = element.querySelector('.playlistOptions').getBoundingClientRect()
            return Math.abs(actions.x + actions.width / 2 - panel.x - panel.width / 2)
          })
          expect(geometry).toBeLessThanOrEqual(1)
        }
      })
    })
  }
}
