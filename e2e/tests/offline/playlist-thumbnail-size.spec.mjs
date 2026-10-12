import { readPersistedDatastore } from '../../helpers/datastore.mjs'
import path from 'node:path'

import { test, expect, goTo, goToSettingsSection, latestSettings } from '../../helpers/app.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const videos = Array.from({ length: 30 }, (_, index) => ({
  videoId: String(index).padStart(11, '0'),
  playlistItemId: `sizing-${index}`,
  title: `Playlist video ${index + 1}: Exploring the mountains`,
  author: 'Test Channel',
  authorId: 'UC-test-channel-id',
  lengthSeconds: 120,
  timeAdded: 1700000000000 + index,
  type: 'video'
}))

async function resize(app, page, width, uiScale) {
  await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setContentSize(Math.round(width * uiScale / 100), 900)
  }, { width, uiScale })
  await expect.poll(() => page.evaluate(width => Math.abs(window.innerWidth - width), width)).toBeLessThanOrEqual(1)
}

async function openPlaylist(page) {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await goTo(page, 'userplaylists')
  await page.getByRole('link', { name: 'Playlist thumbnail sizing', exact: true }).click()
  await expect(page.locator('.playlistItemsCard .ft-list-video').first()).toBeVisible()
}

async function thumbnailWidth(page) {
  return page.locator('.playlistItemsCard .videoThumbnail').first().evaluate(element => element.getBoundingClientRect().width)
}

for (const [thumbnailSize, playlistThumbnailSize] of [[150, undefined], [150, 80], [undefined, undefined]]) {
  test.describe(`saved playlist sizing with global ${thumbnailSize ?? 'default'} and playlist ${playlistThumbnailSize ?? 'unset'}`, () => {
    test.use({
      seed: {
        settings: {
          currentLocale: 'en-US',
          ...(thumbnailSize === undefined ? {} : { thumbnailSize }),
          ...(playlistThumbnailSize === undefined ? {} : { playlistThumbnailSize })
        }
      }
    })

    test('preserves saved thumbnail sizes across startup and global sizing changes', async ({ app, page }) => {
      const expectedSize = playlistThumbnailSize ?? thumbnailSize ?? 100
      let appearance = await goToSettingsSection(page, 'appearance')
      await expect(appearance.getByRole('slider', { name: /^Playlist Thumbnail Size:/ })).toHaveValue(String(expectedSize))
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateThumbnailSize', 60))
      await expect.poll(async () => latestSettings(await readPersistedDatastore(path.join(app.userDataDir, 'settings.db'), 'utf8')).playlistThumbnailSize).toBe(expectedSize)
      const relaunched = await app.relaunch()
      appearance = await goToSettingsSection(relaunched.page, 'appearance')
      await expect(appearance.getByRole('slider', { name: /^Thumbnail Size:/ })).toHaveValue('60')
      await expect(appearance.getByRole('slider', { name: /^Playlist Thumbnail Size:/ })).toHaveValue(String(expectedSize))
    })
  })
}

for (const uiScale of [100, 95]) {
  test.describe(`playlist thumbnail sizing at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          currentLocale: 'en-US',
          playlistViewType: 'list',
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue',
          quickSettings: ['thumbnailSize', 'playlistThumbnailSize'],
          alwaysShowScrollbars: true
        },
        playlists: [{
          _id: 'thumbnail-sizing',
          playlistName: 'Playlist thumbnail sizing',
          description: 'A playlist with independently sized thumbnails.',
          protected: false,
          videos,
          lastUpdatedAt: 1700000000000
        }]
      }
    })

    test('fills the available width in list view', async ({ app, page }, testInfo) => {
      await openPlaylist(page)
      for (const width of [1440, 1000, 812, 375]) {
        await resize(app, page, width, uiScale)
        await expect.poll(() => page.locator('.playlistPage').evaluate(element => {
          const style = getComputedStyle(element)
          const card = element.querySelector('.playlistItemsCard').getBoundingClientRect()
          return Math.abs(element.getBoundingClientRect().right - Number.parseFloat(style.paddingRight) - card.right)
        })).toBeLessThanOrEqual(1)
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
      }

      await resize(app, page, 1440, uiScale)
      await page.evaluate(() => window.scrollTo(0, 0))
      await expectImagesLoaded(page.locator('.playlistInfoContainer img, .playlistItemsCard .thumbnailImage:visible'))
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
        const screenshot = testInfo.outputPath(`playlist-width-${colorScheme}.png`)
        await page.screenshot({ path: screenshot })
        await testInfo.attach(`playlist width (${colorScheme})`, { path: screenshot, contentType: 'image/png' })
      }
    })

    for (const view of ['list', 'grid']) {
      test(`sizes ${view} thumbnails independently and saves the setting`, async ({ app, page }, testInfo) => {
        await openPlaylist(page)
        await page.evaluate(view => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updatePlaylistViewType', view), view)
        await expect(page.locator('.playlistPage')).toHaveClass(new RegExp(`\\b${view}\\b`))
        const defaultWidth = await thumbnailWidth(page)

        await page.locator('.profileTrigger').click()
        const globalSlider = page.locator('.thumbnailSizeSlider input')
        const playlistSlider = page.locator('.playlistThumbnailSizeSlider input')
        await expect(playlistSlider).toBeVisible()
        await globalSlider.press('Home')
        await expect(globalSlider).toHaveValue('60')
        expect(await thumbnailWidth(page)).toBeCloseTo(defaultWidth, 1)
        await playlistSlider.press('End')
        await expect(playlistSlider).toHaveValue('180')
        await expect.poll(() => thumbnailWidth(page)).toBeGreaterThan(defaultWidth)
        await expect(globalSlider).toHaveValue('60')
        for (const colorScheme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme })
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
          const screenshot = testInfo.outputPath(`playlist-size-controls-${view}-${colorScheme}.png`)
          await page.locator('.quickSettingsContent').screenshot({ path: screenshot })
          await testInfo.attach(`independent sizing controls (${colorScheme})`, { path: screenshot, contentType: 'image/png' })
        }
        await page.locator('.profileTrigger').click()

        await expect.poll(async () => latestSettings(await readPersistedDatastore(path.join(app.userDataDir, 'settings.db'), 'utf8')).playlistThumbnailSize).toBe(180)
        const appearance = await goToSettingsSection(page, 'appearance')
        const setting = appearance.locator('.pure-material-slider').filter({ has: page.getByRole('slider', { name: /^Playlist Thumbnail Size:/ }) })
        await expect(setting.getByRole('slider')).toHaveValue('180')
        await setting.getByRole('button', { name: 'Reset this setting to its default' }).click()
        await expect(setting.getByRole('slider')).toHaveValue('100')
        await page.locator('.settingsCloseButton').click()
        await expect.poll(() => thumbnailWidth(page)).toBeCloseTo(defaultWidth, 1)
      })
    }

    test('keeps the full playlist sizing range when phones force list view', async ({ app, page }) => {
      await openPlaylist(page)
      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateListType', 'grid')
        await store.dispatch('updatePlaylistViewType', 'grid')
        await store.dispatch('updateThumbnailSize', 180)
        await store.dispatch('updatePlaylistThumbnailSize', 180)
      })
      await resize(app, page, 375, uiScale)
      await expect(page.locator('.playlistPage')).toHaveClass(/\blist\b/)
      await page.locator('.profileTrigger').click()
      const globalSlider = page.locator('.thumbnailSizeSlider input')
      const playlistSlider = page.locator('.playlistThumbnailSizeSlider input')
      await expect(globalSlider).toHaveAttribute('max', '110')
      await expect(globalSlider).toHaveValue('110')
      await expect(playlistSlider).toHaveAttribute('max', '180')
      await expect(playlistSlider).toHaveValue('180')
      const largeWidth = await thumbnailWidth(page)
      await globalSlider.press('Home')
      expect(await thumbnailWidth(page)).toBeCloseTo(largeWidth, 1)
      await playlistSlider.press('Home')
      await expect.poll(() => thumbnailWidth(page)).toBeLessThan(largeWidth)
      await expect(globalSlider).toHaveValue('60')
      await playlistSlider.press('End')
      await expect.poll(() => thumbnailWidth(page)).toBeCloseTo(largeWidth, 1)
      await page.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
      await resize(app, page, 1440, uiScale)
      await expect(page.locator('.playlistPage')).toHaveClass(/\bgrid\b/)
      await page.locator('.profileTrigger').click()
      await expect(playlistSlider).toHaveValue('180')
      await expect(globalSlider).toHaveValue('60')
    })

    test('keeps scroll offsets and scrollbar geometry valid when the content shrinks', async ({ app, page }) => {
      await openPlaylist(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const update = changes => page.evaluate(async changes => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        for (const [key, value] of Object.entries(changes)) await store.dispatch(key, value)
      }, changes)
      const scrollToBottom = async () => {
        await expect.poll(async () => {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
          return page.locator('.playlistItemsCard .title').filter({ hasText: videos[0].title }).isVisible()
        }).toBe(true)
        await expect.poll(() => page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight)
          return Math.abs(document.documentElement.scrollHeight - window.innerHeight - window.scrollY)
        })).toBeLessThanOrEqual(1)
      }

      for (const trigger of ['smaller list thumbnails', 'wider viewport', 'grid layout', 'smaller grid thumbnails']) {
        await resize(app, page, trigger === 'wider viewport' ? 812 : 1440, uiScale)
        await update({ updatePlaylistViewType: trigger === 'smaller grid thumbnails' ? 'grid' : 'list', updatePlaylistThumbnailSize: trigger === 'grid layout' ? 100 : 180 })
        await scrollToBottom()
        const previousHeight = await page.evaluate(() => document.documentElement.scrollHeight)
        if (trigger === 'wider viewport') await resize(app, page, 1440, uiScale)
        else if (trigger === 'grid layout') await update({ updatePlaylistViewType: 'grid' })
        else await update({ updatePlaylistThumbnailSize: 60 })

        await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(previousHeight)
        await expect(async () => {
          const state = await page.evaluate(() => {
            const root = document.documentElement
            const route = document.querySelector('.playlistPage')
            const shell = document.querySelector('.app > .routerView')
            const bottomMargin = Number.parseFloat(getComputedStyle(route).marginBottom) + Number.parseFloat(getComputedStyle(shell).marginBottom)
            const renderedEnd = route.getBoundingClientRect().bottom + bottomMargin
            const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
            const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
            const handleElement = scrollbar.querySelector('.os-scrollbar-handle')
            const handle = handleElement.getBoundingClientRect()
            const minHeight = Number.parseFloat(getComputedStyle(handleElement).minHeight)
            return {
              offset: window.scrollY,
              range: root.scrollHeight - window.innerHeight,
              emptySpace: window.innerHeight - renderedEnd,
              thumbSizeError: Math.abs(handle.height - Math.max(minHeight, track.height * window.innerHeight / root.scrollHeight)),
              thumbBottomError: Math.abs(track.bottom - handle.bottom),
              unusable: scrollbar.classList.contains('os-scrollbar-unusable')
            }
          })
          const context = `${trigger}: ${JSON.stringify(state)}`
          expect(state.offset, context).toBeGreaterThan(0)
          expect(state.offset, context).toBeLessThanOrEqual(state.range + 1)
          expect(state.emptySpace, `empty space: ${context}`).toBeLessThanOrEqual(2)
          expect(state.thumbSizeError, `thumb size: ${context}`).toBeLessThanOrEqual(2)
          expect(state.thumbBottomError, `thumb position: ${context}`).toBeLessThanOrEqual(2)
          expect(state.unusable, context).toBe(false)
        }).toPass({ timeout: 15_000 })
      }
    })
  })
}
