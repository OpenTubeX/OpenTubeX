import { test, expect, goTo, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'
import { mockCapacitorPhoneLayout } from '../../helpers/mobile.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

async function expectSquare(surface) {
  await expect(surface).toBeVisible()
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    await expect(surface).toHaveCSS(`border-${corner}-radius`, '0px')
  }
}

async function expectFullWidth(surface) {
  await expect.poll(() => surface.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return Math.max(Math.abs(bounds.left), Math.abs(bounds.right - innerWidth))
  })).toBeLessThanOrEqual(1)
}

async function navigate(page, route) {
  const tab = await page.evaluate(route => {
    const url = new URL(`https://app.test/${route}`)
    return window.ftElectron.tabs.create({ route: url.pathname, query: Object.fromEntries(url.searchParams) })
  }, route)
  await expect(page.locator(`.tabContent[data-tab-id="${tab.id}"]`)).toHaveAttribute('aria-hidden', 'false')
  await expect(page).toHaveURL(url => url.hash === `#/${route}`)
}

for (const uiScale of [100, 125]) {
  test.describe(`phone surface corners at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          playlistViewType: 'list',
          backendPreference: 'local',
          defaultInvidiousInstance: 'https://invidious.test',
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
        },
        history: [{
          _id: 'jNQXAC9IVRw',
          videoId: 'jNQXAC9IVRw',
          title: 'Me at the zoo',
          author: 'jawed',
          authorId: CHANNEL_ID,
          published: 1700000000000,
          timeWatched: 1700000000000,
          lengthSeconds: 19,
          watchProgress: 10,
          isWatched: false,
          type: 'video',
        }],
        watchStats: [{ _id: 'history-watch-time-v1', completedAt: 1700000000000, hadEstimates: false, adjustment: null }],
        playlists: [
          { _id: 'empty-corners', playlistName: 'Old funny documentaries', protected: false, videos: [], lastUpdatedAt: 1700000000000 },
          {
            _id: 'populated-corners',
            playlistName: 'Documentaries',
            protected: false,
            videos: [{ videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', author: 'jawed', lengthSeconds: 19, playlistItemId: 'corner-video', type: 'video' }],
            lastUpdatedAt: 1700000000000,
          },
        ],
      },
    })

    test('joins playlist headers to screen edges and content without corner gaps', async ({ page }, testInfo) => {
      await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
      await goTo(page, 'userplaylists')
      await page.getByRole('link', { name: 'Old funny documentaries', exact: true }).click()
      const header = page.locator('.playlistInfoContainer:visible')
      await expect(header).toHaveCSS('border-top-left-radius', '12px')

      await mockCapacitorPhoneLayout(page)
      for (const id of ['empty-corners', 'populated-corners']) {
        await navigate(page, `playlist/${id}?playlistType=user`)
        for (const [width, height] of [[375, 812], [600, 900], [640, 390]]) {
          await page.setViewportSize({ width: Math.round(width * uiScale / 100), height: Math.round(height * uiScale / 100) })
          await expectFullWidth(header)
          await expectSquare(header)
          await expectSquare(page.locator('.playlistItemsCard:visible'))
          await expect.poll(() => header.evaluate(element => Math.abs(
            element.getBoundingClientRect().bottom - element.parentElement.querySelector('.playlistItemsCard').getBoundingClientRect().top
          ))).toBeLessThanOrEqual(1)
          await expect.poll(() => header.getByTitle('Edit Playlist Info').evaluate(element =>
            Number.parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThan(0)

          if (id === 'empty-corners' && width === 375 && uiScale === 100) {
            for (const theme of ['dark', 'light']) {
              await page.emulateMedia({ colorScheme: theme })
              await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
              const clip = await header.evaluate(element => {
                const header = element.getBoundingClientRect()
                const content = element.parentElement.querySelector('.playlistItemsCard').getBoundingClientRect()
                return { x: header.x, y: header.y, width: header.width, height: content.bottom - header.top }
              })
              await page.screenshot({ path: testInfo.outputPath(`playlist-phone-${theme}.png`), clip, animations: 'disabled' })
            }
          }
        }
      }
      await page.setViewportSize({ width: 1600, height: 900 })
      await page.reload()
      await expect(header).toHaveCSS('border-top-left-radius', '12px')
    })

    test('keeps browsing cards and their sticky headers square at the phone edges', async ({ page }) => {
      await mockCapacitorPhoneLayout(page)
      for (const [width, height] of [[375, 812], [640, 390]]) {
        await page.setViewportSize({ width: Math.round(width * uiScale / 100), height: Math.round(height * uiScale / 100) })
        for (const route of ['subscriptions', 'trending', 'popular', 'history', 'userplaylists', 'subscribedchannels', 'stats', 'about']) {
          await navigate(page, route)
          const card = page.locator('.tabContent[aria-hidden="false"] .ft-card:visible').first()
          await expectFullWidth(card)
          await expectSquare(card)
          const header = card.locator('.subscriptionsHeader, .pageHeader')
          if (await header.count()) {
            await expectFullWidth(header)
            await expectSquare(header)
          }
        }
      }
      await page.setViewportSize({ width: Math.round(375 * uiScale / 100), height: Math.round(812 * uiScale / 100) })
      await navigate(page, 'external-media?url=invalid')
      await expectFullWidth(page.locator('.externalMediaError:visible'))
      await expectSquare(page.locator('.externalMediaError:visible'))
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow'))
      await expect(page.locator('.settingsWindow')).toBeVisible()
      await goToSettingsSection(page, 'theme')
      await expect(page.locator('.settingsWindow')).toHaveClass(/maximized/)
      const sections = page.locator('.settingsWindow .sectionBody:visible')
      await expect(sections.first()).toBeVisible()
      for (const section of await sections.all()) {
        const bounds = await section.evaluate(element => {
          const panel = element.getBoundingClientRect()
          const scroller = element.closest('.settingsContent').getBoundingClientRect()
          return { left: panel.left - scroller.left, right: scroller.right - panel.right, radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) }
        })
        expect(bounds.left).toBeGreaterThan(0)
        expect(bounds.right).toBeGreaterThan(0)
        expect(bounds.radius).toBeGreaterThan(0)
      }
    })

    test('keeps full-width More and context sheets square at the screen edges', async ({ page }, testInfo) => {
      await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
      await page.setViewportSize({ width: Math.round(375 * uiScale / 100), height: Math.round(812 * uiScale / 100) })
      await mockCapacitorPhoneLayout(page)
      await navigate(page, 'history')
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      try {
        for (const [width, height] of [[375, 812], [640, 390]]) {
          await page.setViewportSize({ width: Math.round(width * uiScale / 100), height: Math.round(height * uiScale / 100) })
          for (const kind of ['more', 'context']) {
            const menu = page.locator(kind === 'more' ? '.moreOptionContainer' : '.mobileLinkActions')
            if (kind === 'more') {
              await page.locator('.moreOptionNav').click()
            } else {
              const title = page.locator('.tabContent[aria-hidden="false"] .ft-list-video .title').first()
              await title.click({ trial: true })
              const bounds = await title.boundingBox()
              await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }] })
              try {
                await expect(menu).toBeVisible()
              } finally {
                await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
              }
            }
            await expect(menu).toBeVisible()
            await menu.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
            await expectFullWidth(menu)
            await expectSquare(menu)
            if (width === 375 && uiScale === 100) {
              for (const theme of ['dark', 'light']) {
                await page.emulateMedia({ colorScheme: theme })
                await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
                await menu.screenshot({ path: testInfo.outputPath(`${kind}-phone-${theme}.png`), animations: 'disabled' })
              }
            }
            await page.keyboard.press('Escape')
            await expect(menu).toHaveCount(0)
          }
        }
      } finally {
        await session.detach()
      }
    })

    test('removes the channel banner and metadata corner cutouts', async ({ page }, testInfo) => {
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBackendPreference', 'invidious'))
      await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
        json: {
          author: 'Documentary channel',
          authorId: CHANNEL_ID,
          authorThumbnails: [],
          authorBanners: [],
          description: 'Documentaries and more.',
          subCount: 0,
          totalViews: 0,
          joined: 0,
          tabs: ['videos', 'shorts', 'streams', 'playlists'],
          relatedChannels: [],
          videos: [],
          latestVideos: [],
          playlists: [],
        },
      }))
      await navigate(page, `channel/${CHANNEL_ID}`)
      const banner = page.locator('.channelDetails:visible .bannerContainer')
      const info = page.locator('.channelDetails:visible .infoContainer')
      await expect(banner).toHaveCSS('border-top-left-radius', '8px')
      await mockCapacitorPhoneLayout(page)
      for (const [width, height] of [[375, 812], [640, 390]]) {
        await page.setViewportSize({ width: Math.round(width * uiScale / 100), height: Math.round(height * uiScale / 100) })
        for (const surface of [banner, info]) {
          await expectFullWidth(surface)
          await expectSquare(surface)
        }
        if (width === 375 && uiScale === 100) {
          for (const theme of ['dark', 'light']) {
            await page.emulateMedia({ colorScheme: theme })
            await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
            await page.locator('.channelDetails:visible').screenshot({ path: testInfo.outputPath(`channel-phone-${theme}.png`), animations: 'disabled' })
          }
        }
      }
      await page.setViewportSize({ width: 1600, height: 900 })
      await page.reload()
      await expect(banner).toHaveCSS('border-top-left-radius', '8px')
      await expect(info).toHaveCSS('border-bottom-left-radius', '8px')
    })

    test('keeps full-width watch cards square while preserving inset action panels', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await setWindowSize(app, page, { width: Math.round(375 * uiScale / 100), height: Math.round(812 * uiScale / 100) })
      await mockCapacitorPhoneLayout(page)
      const cards = page.locator('.watchVideoInfo:visible, .videoDescription:visible, .watchVideoRecommendations:visible')
      await expect(cards).toHaveCount(3)
      for (const card of await cards.all()) {
        await expectFullWidth(card)
        await expectSquare(card)
      }
      const comments = page.locator('.phoneCommentsButton')
      await expect(comments).toBeVisible()
      const inset = await comments.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        return { left: bounds.left, right: innerWidth - bounds.right, radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) }
      })
      expect(inset.left).toBeGreaterThan(0)
      expect(inset.right).toBeGreaterThan(0)
      expect(inset.radius).toBeGreaterThan(0)

      await comments.click()
      const sheet = page.locator('.mobileSheet.dockedSheet[open]')
      await expectFullWidth(sheet)
      await expectSquare(sheet)
      await sheet.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(sheet).toHaveCount(0)

      const watch = await watchViewHandle(page)
      await watch.evaluate(view => { view.isLoading = true })
      for (const surface of ['.videoPlayerPlaceholder', '.infoSkeleton']) {
        await expectSquare(page.locator(`${surface}:visible`))
      }
      await watch.evaluate(view => { view.mobilePanel = 'comments' })
      await expectSquare(page.locator('.commentsSkeleton:visible'))
      await watch.evaluate(async view => {
        view.mobilePanel = null
        view.isLoading = false
        view.useCustomShortsPlayerForCurrentVideo = true
        view.updateShortsPlayerState(30, [{ width: 360, height: 640 }])
        await view.$nextTick()
      })
      for (const surface of ['.shortsSwipeViewport', '.videoPlayer', '.ftVideoPlayer']) {
        const element = page.locator(`.shortsPlayerActive ${surface}:visible`)
        await expectFullWidth(element)
        await expectSquare(element)
      }
      await watch.dispose()
    })
  })
}
