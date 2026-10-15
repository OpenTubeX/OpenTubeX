import { test, expect, goTo, sel } from '../../helpers/app.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const videos = Array.from({ length: 6 }, (_, index) => ({
  videoId: `layout0000${index}`,
  playlistItemId: `rounded-${index}`,
  title: `Mountain walks ${index + 1}`,
  author: 'Test channel',
  lengthSeconds: 120,
  type: 'video'
}))

async function openPlaylist(page) {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.route('https://invidious.test/vi/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await goTo(page, 'userplaylists')
  await page.getByRole('link', { name: 'Mountain walks', exact: true }).click()
  await expect(page.locator('.playlistItemsCard .videoThumbnail').first()).toBeVisible()
}

async function updateSetting(page, action, value) {
  await page.evaluate(({ action, value }) => window.$store.dispatch(action, value), { action, value })
}

async function resize(app, page, width, uiScale) {
  await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(Math.round(width * uiScale / 100), Math.round(900 * uiScale / 100))
  }, { width, uiScale })
  await expect.poll(() => page.evaluate(width => Math.abs(innerWidth - width), width)).toBeLessThanOrEqual(1)
}

test.describe('playlist spacing and corners', { tag: '@scale' }, () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'system',
        systemDarkTheme: 'dark',
        systemLightTheme: 'light',
        playlistViewType: 'grid',
        listType: 'grid',
        backendPreference: 'invidious',
        backendFallback: false,
        enableSearchSuggestions: false,
        defaultInvidiousInstance: 'https://invidious.test'
      },
      playlists: [{
        _id: 'rounded-playlist',
        playlistName: 'Mountain walks',
        protected: false,
        description: '',
        videos,
        lastUpdatedAt: 1700000000000
      }]
    }
  })

  test('balances the unavailable-video banner in the grid card', async ({ app, page, uiScale }, testInfo) => {
    await updateSetting(page, 'updateBackendPreference', 'local')
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.route('https://www.youtube.com/youtubei/v1/browse**', route => route.fulfill({
      json: {
        metadata: { playlistMetadataRenderer: { title: 'Mountain walks', description: '' } },
        sidebar: {
          playlistSidebarRenderer: {
            items: [{
              playlistSidebarPrimaryInfoRenderer: {
                title: { simpleText: 'Mountain walks' },
                stats: [{ simpleText: '6 videos' }, { simpleText: 'No views' }],
                thumbnailRenderer: {
                  playlistVideoThumbnailRenderer: {
                    thumbnail: {
                      thumbnails: [{ url: 'https://i.ytimg.com/vi/layout00000/hqdefault.jpg', width: 480, height: 360 }]
                    }
                  }
                },
                menu: { menuRenderer: { items: [{ menuNavigationItemRenderer: { text: { simpleText: 'Show unavailable videos' } } }] } }
              }
            }]
          }
        },
        contents: {
          twoColumnBrowseResultsRenderer: {
            tabs: [{
              tabRenderer: {
                selected: true,
                content: {
                  sectionListRenderer: {
                    contents: [{
                      itemSectionRenderer: {
                        contents: [{
                          playlistVideoListRenderer: {
                            playlistId: 'PL-rounded-playlist',
                            contents: videos.map((video, index) => ({
                              playlistVideoRenderer: {
                                videoId: video.videoId,
                                index: { simpleText: String(index + 1) },
                                title: { simpleText: video.title, accessibility: { accessibilityData: { label: video.title } } },
                                shortBylineText: { runs: [{ text: video.author, navigationEndpoint: { browseEndpoint: { browseId: 'UC-test-channel' } } }] },
                                thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`, width: 480, height: 360 }] },
                                lengthSeconds: String(video.lengthSeconds),
                                isPlayable: true,
                                navigationEndpoint: { watchEndpoint: { videoId: video.videoId } }
                              }
                            }))
                          }
                        }]
                      }
                    }]
                  }
                }
              }
            }]
          }
        }
      }
    }))
    await page.locator(sel.searchInput).fill('https://www.youtube.com/playlist?list=PL-rounded-playlist')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.locator('.alertBox')).toContainText('Unavailable videos are hidden')
    for (const width of [1440, 900, 700]) {
      await resize(app, page, width, uiScale)
      await expect(page.locator('.playlistPage.grid')).toBeVisible()
      const spacing = await page.locator('.playlistItemsCard').evaluate(element => {
        const card = element.getBoundingClientRect()
        const banner = element.querySelector('.alertBox').getBoundingClientRect()
        const thumbnail = element.querySelector('.videoThumbnail').getBoundingClientRect()
        return { above: banner.top - card.top, below: thumbnail.top - banner.bottom }
      })
      expect(spacing.above, JSON.stringify(spacing)).toBeCloseTo(16, 0)
      expect(Math.abs(spacing.above - spacing.below), JSON.stringify(spacing)).toBeLessThanOrEqual(1)
    }
    await resize(app, page, 1440, uiScale)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expectImagesLoaded(page.locator('.playlistItemsCard img:visible'))
    const clip = await page.locator('.playlistItemsCard').evaluate(element => {
      const card = element.getBoundingClientRect()
      const thumbnail = element.querySelector('.videoThumbnail').getBoundingClientRect()
      return { x: card.x, y: card.y, width: card.width, height: thumbnail.bottom - card.y }
    })
    await page.screenshot({ path: testInfo.outputPath('balanced-playlist-banner.png'), clip })
    await page.locator('.alertBox').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('.alertBox')).toHaveCount(0)
    await expect(page.locator('.playlistItemsCard')).toHaveCSS('padding-top', '3px', { timeout: 1000 })
    const thumbnailInset = await page.locator('.playlistItemsCard').evaluate(element =>
      element.querySelector('.videoThumbnail').getBoundingClientRect().top - element.getBoundingClientRect().top
    )
    expect(thumbnailInset).toBeCloseTo(9, 0)
  })

  test('grid playlists without a notice preserve their normal padding', async ({ app, page, uiScale }) => {
    await openPlaylist(page)
    for (const width of [1440, 900, 700]) {
      await resize(app, page, width, uiScale)
      await expect(page.locator('.playlistPage.grid')).toBeVisible()
      await expect(page.locator('.alertBox')).toHaveCount(0)
      await expect(page.locator('.sortSelect')).toBeVisible()
      await expect(page.locator('.playlistItemsCard')).toHaveCSS('padding-top', '3px', { timeout: 1000 })
    }
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setAllPlaylists', [{ ...store.getters.getPlaylist('rounded-playlist'), videos: [] }])
    })
    await expect(page.locator('.playlistItemsCard .message')).toContainText('This playlist currently has no videos.')
    await expect(page.locator('.playlistItemsCard')).toHaveCSS('padding-top', '3px', { timeout: 1000 })
  })

  test('playlist page thumbnail follows UI roundness', async ({ app, page, uiScale }, testInfo) => {
    await openPlaylist(page)
    await updateSetting(page, 'updatePlaylistViewType', 'list')
    await resize(app, page, 1440, uiScale)
    const image = page.locator('.playlistInfo .playlistThumbnail img')
    await expectImagesLoaded(image)
    for (const roundness of [100, 0, 50, 200]) {
      await updateSetting(page, 'updateUiRoundness', roundness)
      await expect(image).toHaveCSS('border-radius', `${8 * roundness / 100}px`, { timeout: 1000 })
      // Small radii are covered by CSS assertions; pixel-sized hit probes can intersect their curve.
      if (roundness === 50) continue
      const corners = await image.evaluate(element => {
        const box = element.getBoundingClientRect()
        return [
          [box.left + 0.25, box.top + 0.25], [box.right - 0.25, box.top + 0.25],
          [box.left + 0.25, box.bottom - 0.25], [box.right - 0.25, box.bottom - 0.25]
        ].map(([x, y]) => document.elementsFromPoint(x, y).includes(element))
      })
      expect(corners).toEqual(Array(4).fill(roundness === 0))
    }
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
      await image.screenshot({ path: testInfo.outputPath(`rounded-playlist-header-${colorScheme}.png`) })
    }
  })

  test('blurred playlist thumbnails stay inside their rounded frame', async ({ app, page, uiScale }, testInfo) => {
    await openPlaylist(page)
    await updateSetting(page, 'updatePlaylistViewType', 'list')
    await resize(app, page, 1440, uiScale)
    const frame = page.locator('.playlistInfo .playlistThumbnail')
    const image = frame.locator('img')
    await expectImagesLoaded(image)
    // Electron's screenshot clips use coordinates before its UI zoom is applied.
    const screenshotScale = uiScale / 100
    for (const roundness of [100, 0, 50, 200]) {
      await updateSetting(page, 'updateUiRoundness', roundness)
      await updateSetting(page, 'updateBlurThumbnails', false)
      const box = await image.boundingBox()
      const outsideFrame = {
        x: (box.x + box.width + 2) * screenshotScale,
        y: (box.y + box.height / 2) * screenshotScale,
        width: 4 * screenshotScale,
        height: 4 * screenshotScale
      }
      const background = await page.screenshot({ clip: outsideFrame, animations: 'disabled', scale: 'css' })
      await updateSetting(page, 'updateBlurThumbnails', true)
      await expect(image).toHaveCSS('filter', 'blur(20px)')
      const blurredBackground = await page.screenshot({ clip: outsideFrame, animations: 'disabled', scale: 'css' })
      expect(blurredBackground, `roundness ${roundness}: blur must not paint outside the frame`).toEqual(background)
      await expect(frame).toHaveCSS('border-radius', `${8 * roundness / 100}px`, { timeout: 1000 })
      const frameBox = await frame.boundingBox()
      expect(frameBox.height).toBeCloseTo(box.height, 0)
    }
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
      const box = await frame.boundingBox()
      await page.screenshot({
        path: testInfo.outputPath(`rounded-blurred-playlist-${colorScheme}.png`),
        clip: { x: (box.x - 8) * screenshotScale, y: (box.y - 8) * screenshotScale, width: (box.width + 16) * screenshotScale, height: (box.height + 16) * screenshotScale }
      })
    }
  })

  test('playlist count overlay follows thumbnail corners in search and saved playlists', async ({ app, page, uiScale }, testInfo) => {
    await page.route('https://invidious.test/vi/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.route('https://invidious.test/api/v1/search/**', route => route.fulfill({
      json: [{
        type: 'playlist',
        title: 'Mountain walks',
        playlistId: 'PL-rounded-playlist',
        playlistThumbnail: 'https://i.ytimg.com/vi/layout00000/hqdefault.jpg',
        author: 'Test channel',
        authorId: '',
        videoCount: 6,
        videos: []
      }]
    }))
    await page.locator(sel.searchInput).fill('Mountain walks')
    await page.locator(sel.searchInput).press('Enter')
    for (const view of ['search', 'userplaylists']) {
      if (view === 'userplaylists') await goTo(page, view)
      const thumbnail = page.locator('.ft-list-item .videoThumbnail').first()
      for (const listType of ['grid', 'list']) {
        await updateSetting(page, 'updateListType', listType)
        for (const width of [1440, 375]) {
          await resize(app, page, width, uiScale)
          await expectImagesLoaded(thumbnail.locator('img'))
          for (const direction of ['ltr', 'rtl']) {
            await page.locator('body').evaluate((body, dir) => { body.dir = dir }, direction)
            for (const roundness of [100, 0, 50, 200]) {
              await updateSetting(page, 'updateUiRoundness', roundness)
              const count = thumbnail.locator('.videoCountContainer')
              await expect(count).toHaveCSS('border-start-end-radius', `${8 * roundness / 100}px`, { timeout: 1000 })
              await expect(count).toHaveCSS('border-end-end-radius', `${8 * roundness / 100}px`, { timeout: 1000 })
              // Keep painted-corner probes clear of Chromium's pixel-sized hit area.
              if (roundness === 50) continue
              await count.scrollIntoViewIfNeeded()
              const crop = await count.evaluate(element => {
                element.style.pointerEvents = 'auto'
                try {
                  const box = element.getBoundingClientRect()
                  const x = getComputedStyle(element).direction === 'rtl' ? box.left + 0.25 : box.right - 0.25
                  const background = element.querySelector('.background')
                  return {
                    box: box.toJSON(),
                    viewport: { width: innerWidth, height: innerHeight },
                    center: document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2).includes(background),
                    corners: [box.top + 0.25, box.bottom - 0.25].map(y => document.elementsFromPoint(x, y).includes(background))
                  }
                } finally {
                  element.style.removeProperty('pointer-events')
                }
              })
              const context = `${view}, ${listType}, ${width}px, ${direction}, roundness ${roundness}: ${JSON.stringify(crop)}`
              expect(crop.center, context).toBe(true)
              expect(crop.corners, context).toEqual(Array(2).fill(roundness === 0))
            }
          }
          await page.locator('body').evaluate(body => { body.dir = 'ltr' })
          if (view === 'search' && listType === 'grid' && width === 1440) {
            for (const colorScheme of ['dark', 'light']) {
              await page.emulateMedia({ colorScheme })
              await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
              await thumbnail.locator('..').screenshot({ path: testInfo.outputPath(`rounded-search-playlist-${colorScheme}.png`) })
            }
          }
        }
      }
    }
  })
})
