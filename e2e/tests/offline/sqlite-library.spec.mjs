import { readFile } from 'node:fs/promises'
import { readPersistedDatastore } from '../../helpers/datastore.mjs'
import path from 'node:path'
import { test, expect, goTo, goToSettingsSection, openNewWindowFromTabBar, waitForAppReady, updateInputWithoutScrolling, repoRoot, sel } from '../../helpers/app.mjs'
import { DBActions, IpcChannels } from '../../../src/constants.js'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'
import { watchViewHandle, mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { demoPlayerResponse, routeDemoMedia } from '../../helpers/media.mjs'

const history = Array.from({ length: 350 }, (_, index) => ({
  _id: `history-${index}`,
  videoId: `v${String(index).padStart(10, '0')}`,
  title: `Library video ${index}`,
  author: 'Example channel',
  type: 'video',
  timeWatched: 1600000000000 + index,
  lengthSeconds: 300,
  watchProgress: 10,
  isWatched: false,
  unknownLegacyField: { index },
}))
const playlist = {
  _id: 'large',
  playlistName: 'Large legacy playlist',
  protected: true,
  createdAt: 1,
  lastUpdatedAt: 1,
  futureMetadata: { preserved: true },
  videos: Array.from({ length: 20000 }, (_, index) => ({
    videoId: `v${String(index % 350).padStart(10, '0')}`,
    playlistItemId: 'duplicate-legacy-id',
    title: `Playlist entry ${index}`,
    author: 'Example channel',
    type: 'video',
    timeAdded: index,
  })),
}

test.describe('channel saved state outside the recent history page', () => {
  const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  const categories = ['videos', 'shorts', 'live']
  const watchedIds = categories.map((_, index) => `old0000000${index}`)
  const saved = categories.map((category, index) => ({
    _id: `older-${category}`,
    videoId: watchedIds[index],
    title: `Watched ${category}`,
    timeWatched: index + 1,
    isWatched: true,
    watchProgress: 77,
    unknownLegacyField: { category },
  }))
  test.use({
    seed: {
      settings: {
        backendPreference: 'invidious',
        backendFallback: false,
        defaultInvidiousInstance: 'https://invidious.test',
        hideWatchedSubs: true,
        historyWatchedStatusMigrated: true,
        currentLocale: 'en_US',
        uiScale: 95,
      },
      history: [...history.slice(0, 105), ...saved],
      playlists: [],
    }
  })
  test('hydrates videos, Shorts and live streams before rendering and retains their filters after refresh', async ({ app, page }, testInfo) => {
    await page.route('https://invidious.test/api/v1/channels/**', route => {
      const tab = new URL(route.request().url()).pathname.split('/').at(-1)
      const index = categories.indexOf(tab === 'streams' ? 'live' : tab)
      return route.fulfill({
        json: index < 0
          ? {
              author: 'Channel',
              authorId: channelId,
              authorThumbnails: [],
              authorBanners: [],
              description: '',
              subCount: 0,
              totalViews: 0,
              joined: 0,
              tabs: categories,
              relatedChannels: [],
            }
          : {
              continuation: null,
              videos: [watchedIds[index], `new0000000${index}`].map((videoId, position) => ({
                videoId,
                title: `${position === 0 ? 'Watched' : 'Unwatched'} ${categories[index]}`,
                type: 'video',
                author: 'Channel',
                authorId: channelId,
                authorUrl: `/channel/${channelId}`,
                videoThumbnails: [],
                lengthSeconds: 120,
                viewCount: 1000,
                published: 1700000000,
                publishedText: '1 year ago',
                liveNow: false,
              })),
            }
      })
    })
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.route('https://invidious.test/vi/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.route('https://invidious.test/ggpht/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await app.electronApp.evaluate(({ ipcMain }, ids) => {
      const handler = ipcMain._invokeHandlers.get('library-query')
      const ready = new Promise(resolve => { globalThis.sqliteChannelStateRelease = resolve })
      globalThis.sqliteChannelStateWaiting = false
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', async (event, request) => {
        if (request.method === 'videoState' && request.data.ids.some(id => ids.includes(id))) {
          globalThis.sqliteChannelStateWaiting = true
          await ready
        }
        return handler(event, request)
      })
    }, watchedIds)
    try {
      await page.evaluate(ids => {
        window.sqliteChannelWatchedFlashes = []
        const inspect = () => {
          for (const id of ids) {
            if (document.querySelector(`.channelContent a[href*="/${id}"]`)) window.sqliteChannelWatchedFlashes.push(id)
          }
        }
        window.sqliteChannelObserver = new MutationObserver(inspect)
        window.sqliteChannelObserver.observe(document.body, { childList: true, subtree: true })
      }, watchedIds)
      await page.evaluate(id => window.ftElectron.tabs.create({ route: `/channel/${id}`, makeActive: true }), channelId)
      await expect.poll(() => app.electronApp.evaluate(() => globalThis.sqliteChannelStateWaiting)).toBe(true)
      const header = page.locator('.channelDetails:visible')
      const content = page.locator('.channelContent:visible')
      await expect(content.locator('.ft-list-video')).toHaveCount(0)
      await app.electronApp.evaluate(() => globalThis.sqliteChannelStateRelease())
      for (const [index, category] of categories.entries()) {
        await header.locator(`#${category}Tab`).click()
        await expect(content.getByRole('link', { name: `Unwatched ${category}`, exact: true }).first()).toBeVisible()
        await expect(content.locator(`a[href*="/${watchedIds[index]}"]`)).toHaveCount(0)
      }
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('grabHistory'))
      for (const [index, category] of categories.entries()) {
        await header.locator(`#${category}Tab`).click()
        await expect(content.getByRole('link', { name: `Unwatched ${category}`, exact: true }).first()).toBeVisible()
        await expect(content.locator(`a[href*="/${watchedIds[index]}"]`)).toHaveCount(0)
      }
      expect(await page.evaluate(() => window.sqliteChannelWatchedFlashes)).toStrictEqual([])
      expect((await page.evaluate(ids => window.ftElectron.libraryQuery('videoState', { ids }), watchedIds)).history).toStrictEqual(saved)
      await expectImagesLoaded(content.locator('img.thumbnailImage'))
      await expect(content.locator('.videoSwipeFrame')).toHaveCSS('opacity', '1')
      await page.screenshot({ path: testInfo.outputPath('channel-saved-history-95.png'), animations: 'disabled' })
    } finally {
      await app.electronApp.evaluate(() => globalThis.sqliteChannelStateRelease())
      await page.evaluate(() => window.sqliteChannelObserver?.disconnect())
    }
  })
})

for (const [sort, theme] of [['video_duration_ascending', 'dark'], ['video_duration_descending', 'light']]) {
  test.describe(`saved playlist duration display ${sort}`, () => {
    const saved = {
      _id: 'durations',
      playlistName: 'Saved durations',
      lastUpdatedAt: 1,
      futureMetadata: { keep: true },
      videos: [
        { videoId: 'v0000000000', playlistItemId: 'fallback', title: 'Duration from newest history', author: 'Example channel', type: 'video', lengthSeconds: 0, timeAdded: 1, unknown: { keep: true } },
        { videoId: 'v0000000001', playlistItemId: 'explicit', title: 'Saved explicit duration', author: 'Example channel', type: 'video', lengthSeconds: 30, timeAdded: 2 },
      ]
    }
    const histories = [
      { ...history[0], _id: 'older', timeWatched: 1, lengthSeconds: 900, watchProgress: 20 },
      { ...history[0], _id: 'newest', timeWatched: 2, lengthSeconds: 600, watchProgress: 300 },
    ]
    test.use({ seed: { settings: { historyWatchedStatusMigrated: true, userPlaylistSortOrder: sort, playlistViewType: 'list', uiScale: 95, currentLocale: 'en_US', baseTheme: theme }, history: histories, playlists: [saved], watchStats: [{ _id: 'history-watch-time-v1' }] } })
    test('shows the history-filled duration and progress without changing the saved playlist', async ({ page }, testInfo) => {
      await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
      await goTo(page, 'userplaylists')
      await page.getByRole('link', { name: 'Saved durations', exact: true }).click()
      const content = page.locator('.tabContent[aria-hidden="false"] .playlistPage')
      const fallback = content.locator('[data-video-id="v0000000000"]')
      await expect(fallback.locator('.videoDuration')).toHaveText('10:00')
      await expect(fallback.locator('.watchedProgressBar')).toBeVisible()
      await expect(content.locator('.playlistItem').first()).toHaveAttribute('data-video-id', sort.endsWith('ascending') ? 'v0000000001' : 'v0000000000')
      expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'durations' }))).toStrictEqual(saved)
      expect((await page.evaluate(() => window.ftElectron.libraryQuery('videoState', { ids: ['v0000000000'] }))).history).toStrictEqual([histories[1]])
      await content.screenshot({ path: testInfo.outputPath(`saved-durations-${theme}.png`) })
    })
  })
}

test.describe('Home new subscription content paging', () => {
  const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  const timestamp = Date.now()
  const entries = Array.from({ length: 230 }, (_, index) => ({
    videoId: `v${String(index).padStart(10, '0')}`,
    title: `Unseen library video ${index}`,
    author: 'Example channel',
    authorId: channelId,
    type: 'video',
    lengthSeconds: 120,
    published: timestamp - index * 60000,
    viewCount: 1000,
    isNewInSubscriptionFeed: true,
    unknownLegacyField: { index },
  }))
  test.use({
    seed: {
      settings: { historyWatchedStatusMigrated: true, fetchSubscriptionsAutomatically: false, showNewSubscriptionFeed: true, useRssFeeds: false, uiScale: 95, animationSpeed: 1000, currentLocale: 'en_US', landingPage: 'history' },
      history: [],
      playlists: [],
      watchStats: [{ _id: 'history-watch-time-v1' }],
      profiles: [{ _id: 'allChannels', name: 'All Channels', subscriptions: [{ id: channelId, name: 'Example channel', thumbnail: '' }] }, { _id: 'other', name: 'Other profile', subscriptions: [] }],
      subscriptionCache: [{ _id: channelId, videos: entries, videosTimestamp: new Date(timestamp).toISOString(), shorts: [], liveStreams: [], communityPosts: [] }],
    }
  })
  for (const view of ['Home', 'New feed']) {
    test(`${view} hides previous-profile subscriptions when the replacement read fails`, async ({ app, page }) => {
      await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
      await goTo(page, view === 'Home' ? 'home' : 'subscriptions')
      if (view === 'New feed') await page.getByRole('tab', { name: 'New', exact: true }).click()
      const content = page.locator(view === 'Home' ? '[data-home-section="newSinceLastVisit"]' : '.newFeed')
      await expect(content).toContainText('Unseen library video 0')
      await app.electronApp.evaluate(({ ipcMain }) => {
        const handler = ipcMain._invokeHandlers.get('library-query')
        ipcMain.removeHandler('library-query')
        ipcMain.handle('library-query', (event, request) => {
          if (request.method === 'subscriptionPage') throw new Error('simulated new-profile subscription read failure')
          return handler(event, request)
        })
      })
      await page.locator('.topNav .profileTrigger').click()
      await page.locator('.profileSummary').click()
      await page.locator('.profileList .profileOption').filter({ hasText: 'Other profile' }).click()
      await expect(content.getByText('Unseen library video 0', { exact: true })).toHaveCount(0)
      await expect(content.getByRole('button', { name: 'Retry', exact: true }).first()).toBeVisible()
      expect(await page.evaluate(({ channelId, ids }) => window.ftElectron.libraryQuery('subscriptionEntries', { channelId, field: 'videos', ids }), { channelId, ids: entries.map(entry => entry.videoId) })).toStrictEqual(entries)
    })
  }
  test('Home keeps an initial subscription read failure visible and retries only that category', async ({ app, page }, testInfo) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await app.electronApp.evaluate(({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('library-query')
      let fail = true
      globalThis.homeSubscriptionRetryReads = {}
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', (event, request) => {
        if (request.method === 'subscriptionPage') {
          const category = request.data.category
          globalThis.homeSubscriptionRetryReads[category] = (globalThis.homeSubscriptionRetryReads[category] ?? 0) + 1
          if (category === 'shorts' && !request.data.cursor && fail) {
            fail = false
            throw new Error('simulated initial Home subscription read failure')
          }
        }
        return handler(event, request)
      })
    })
    await goTo(page, 'home')
    const section = page.locator('[data-home-section="newSinceLastVisit"]')
    await expect(section).toBeVisible()
    await expect(section.getByRole('alert')).toContainText('Could not load app data')
    const before = await app.electronApp.evaluate(() => globalThis.homeSubscriptionRetryReads)
    await section.screenshot({ path: testInfo.outputPath('home-subscription-initial-read-retry-95.png') })
    await section.locator('[data-home-subscription-retry="shorts"]').getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(section.getByRole('alert')).toHaveCount(0)
    await expect(section.locator('.shelfPage:not([aria-hidden="true"])')).toContainText('Unseen library video 0')
    const after = await app.electronApp.evaluate(() => globalThis.homeSubscriptionRetryReads)
    expect(after).toStrictEqual({ ...before, shorts: before.shorts + 1 })
    expect(await page.evaluate(({ channelId, ids }) => window.ftElectron.libraryQuery('subscriptionEntries', { channelId, field: 'videos', ids }), { channelId, ids: entries.map(entry => entry.videoId) })).toStrictEqual(entries)
  })
  test('loads Home unseen subscriptions beyond one hundred, recovers from a failed page and retains the feed', async ({ app, page }, testInfo) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await app.electronApp.evaluate(({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('library-query')
      let fail = true
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', (event, request) => {
        if (request.method === 'subscriptionPage' && request.data.cursor && fail) { fail = false; throw new Error('simulated Home subscription page failure') }
        return handler(event, request)
      })
    })
    await goTo(page, 'home')
    const section = page.locator('[data-home-section="newSinceLastVisit"]')
    const shelf = section.locator('[data-home-shelf]')
    const next = shelf.getByRole('button', { name: 'Next New since last visit page', exact: true })
    const activePage = shelf.locator('.shelfPage:not([aria-hidden="true"])')
    await expect(activePage).toContainText('Unseen library video 0')
    let failureObserved = false
    for (let count = 0; count < 140; count++) {
      const previous = Number(await activePage.getAttribute('data-home-shelf-page'))
      const columns = await activePage.evaluate(element => Number(element.style.getPropertyValue('--home-shelf-columns')))
      if (previous === Math.ceil(entries.length / columns)) break
      await next.click()
      if (!failureObserved && (previous + 1) * columns > 100) {
        failureObserved = true
        await expect(activePage).toHaveAttribute('data-home-shelf-page', String(previous))
      } else await expect(activePage).toHaveAttribute('data-home-shelf-page', String(previous + 1))
      await expect(shelf).toHaveAttribute('aria-busy', 'false')
    }
    expect(failureObserved).toBe(true)
    await expect(next).toBeDisabled()
    await expect(activePage).toContainText('Unseen library video 229')
    expect(await page.evaluate(({ channelId, ids }) => window.ftElectron.libraryQuery('subscriptionEntries', { channelId, field: 'videos', ids }), { channelId, ids: entries.map(entry => entry.videoId) })).toStrictEqual(entries)
    const screenshot = testInfo.outputPath('home-new-subscriptions-older-page-95.png')
    await section.screenshot({ path: screenshot })
    await testInfo.attach('home-new-subscriptions-older-page-95', { path: screenshot, contentType: 'image/png' })
  })
  test('Home mixed-category pages keep the complete timestamp order while loading older content', async ({ page }) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    const shorts = Array.from({ length: 5 }, (_, index) => ({ ...entries[index], videoId: `s${String(index).padStart(10, '0')}`, title: `Older unseen short ${index}`, isShort: true, published: timestamp - 99900000 - index }))
    await page.evaluate(({ channelId, shorts, timestamp }) => window.ftElectron.dbSubscriptionCache(22, { channelId, entries: shorts, timestamp }), { channelId, shorts, timestamp })
    await goTo(page, 'home')
    const shelf = page.locator('[data-home-section="newSinceLastVisit"] [data-home-shelf]')
    const next = shelf.getByRole('button', { name: 'Next New since last visit page', exact: true })
    const active = shelf.locator('.shelfPage:not([aria-hidden="true"])')
    await expect(active).toContainText('Unseen library video 0')
    const shown = []
    for (let attempt = 0; attempt < 240; attempt++) {
      shown.push(...await active.locator('.mediaDetails strong').allTextContents())
      if (await next.isDisabled()) break
      const before = Number(await active.getAttribute('data-home-shelf-page'))
      await next.click()
      await expect(active).toHaveAttribute('data-home-shelf-page', String(before + 1))
      await expect(shelf).toHaveAttribute('aria-busy', 'false')
    }
    expect(shown).toStrictEqual([...entries, ...shorts].map(entry => entry.title))
    expect(await page.evaluate(({ channelId, ids }) => window.ftElectron.libraryQuery('subscriptionEntries', { channelId, field: 'videos', ids }), { channelId, ids: entries.map(entry => entry.videoId) })).toStrictEqual(entries)
  })

  test('New feed restores its loaded extent before restoring the scroll position after remount', async ({ page }) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    const state = await page.evaluate(() => window.ftElectron.tabs.getState())
    const tabId = state.activeTabId
    await page.evaluate(id => sessionStorage.setItem(`Subscriptions/${id}/new/dataLimit`, '200'), tabId)
    await goTo(page, 'subscriptions')
    await page.getByRole('tab', { name: 'New', exact: true }).click()
    await expect(page.locator('.newFeed [data-feed-item-key]')).toHaveCount(200)
    await page.evaluate(() => window.scrollTo(0, 1500))
    const top = await page.evaluate(() => window.scrollY)
    expect(top).toBeGreaterThan(1000)
    await goTo(page, 'history')
    await page.getByRole('button', { name: 'Back (Alt+Left Arrow) Right-click or hold to see history', exact: true }).click()
    await expect(page.locator('.newFeed [data-feed-item-key]')).toHaveCount(200)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(top)
  })
})

test.describe('paged library review recovery', () => {
  const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  const now = Date.now()
  const saved = { ...playlist, videos: playlist.videos.slice(0, 350) }
  const entry = { videoId: 'abcdefghijk', title: 'Retained new content', author: 'Example channel', authorId: channelId, published: now, lengthSeconds: 120, type: 'video', isNewInSubscriptionFeed: true }
  const categories = {
    shorts: { field: 'shorts', title: 'Retained short', records: [{ ...entry, videoId: 'short000001', title: 'Retained short' }] },
    live: { field: 'liveStreams', title: 'Retained live stream', records: [{ ...entry, videoId: 'live0000001', title: 'Retained live stream', liveNow: true }] },
    posts: { field: 'communityPosts', title: 'Retained community post', records: [{ postId: 'post', postText: 'Retained community post', author: entry.author, authorId: channelId, authorThumbnails: [], publishedTime: now, voteCount: 1, commentCount: 0, postContent: { type: 'text', content: '' }, type: 'community', isNewInSubscriptionFeed: true }] },
  }
  test.use({
    seed: {
      settings: { historyWatchedStatusMigrated: true, currentLocale: 'en_US', uiScale: 95, landingPage: 'history', fetchSubscriptionsAutomatically: false, showNewSubscriptionFeed: true, useRssFeeds: false, animationSpeed: 1000, videoPlaybackEngine: 'yt-dlp', ytDlpPreloadConcurrency: 32, generalAutoLoadMorePaginatedItemsEnabled: false, userPlaylistSortOrder: 'custom' },
      playlists: [saved],
      history: [],
      watchStats: [{ _id: 'history-watch-time-v1' }],
      profiles: [{ _id: 'allChannels', name: 'All Channels', subscriptions: [{ id: channelId, name: entry.author, thumbnail: '' }] }],
      subscriptionCache: [{ _id: channelId, videos: [], videosTimestamp: new Date(now).toISOString(), ...Object.fromEntries(Object.values(categories).flatMap(({ field, records }) => [[field, records], [`${field}Timestamp`, new Date(now).toISOString()]])) }],
    }
  })

  test('preloads every off-page playlist video without expanding the displayed page', async ({ app, page }) => {
    await page.route('https://example.invalid/**', route => route.fulfill({ status: 200, contentType: 'video/webm', body: 'test stream' }))
    await app.electronApp.evaluate(({ ipcMain }, channel) => {
      globalThis.libraryPreloadIds = []
      globalThis.libraryPreloadPages = []
      const handler = ipcMain._invokeHandlers.get('library-query')
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', (event, request) => {
        if (request.method === 'playlistPage') globalThis.libraryPreloadPages.push(request.data)
        return handler(event, request)
      })
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, videoId) => {
        globalThis.libraryPreloadIds.push(videoId)
        return { isLive: false, liveStatus: 'not_live', hlsManifestUrl: null, formats: [{ formatId: '43', url: 'https://example.invalid/video.webm?expire=4102444800', manifestUrl: null, protocol: 'https', ext: 'webm', container: 'webm', vcodec: 'vp9', acodec: 'opus', width: 640, height: 360, fps: 15, bitrate: 200_000, audioSampleRate: 48_000, audioChannels: 2, language: null, formatNote: '360p', dynamicRange: 'SDR', availableAt: null }], duration: 30, storyboardVtt: null, captions: [], captionTranslations: [], title: videoId, version: 'test' }
      })
    }, IpcChannels.YT_DLP_GET_PLAYBACK_INFO)
    await goTo(page, 'userplaylists')
    await page.getByText(saved.playlistName, { exact: true }).click()
    await expect(page.locator('.playlistItemsCard [data-feed-item-key]')).toHaveCount(100)
    await page.getByTitle('Preload all videos').click()
    await expect(page.getByText('Preloaded videos: 350.', { exact: true })).toBeVisible()
    expect(await app.electronApp.evaluate(() => [...new Set(globalThis.libraryPreloadIds)])).toStrictEqual(saved.videos.map(video => video.videoId))
    const reads = await app.electronApp.evaluate(() => globalThis.libraryPreloadPages)
    expect(reads.every(read => read.limit <= 250)).toBe(true)
    await expect(page.locator('.playlistItemsCard [data-feed-item-key]')).toHaveCount(100)
    await expect(page.getByTitle('All playlist videos are already preloaded')).toHaveAttribute('aria-disabled', 'true')
    expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))).toStrictEqual(saved)
  })

  test('combined New feed retains failed secondary categories and retries each category independently', async ({ app, page }, testInfo) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await app.electronApp.evaluate(({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('library-query')
      const failures = new Set(['shorts', 'live', 'posts'])
      globalThis.newFeedRetryReads = {}
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', (event, request) => {
        if (request.method === 'subscriptionPage') {
          const category = request.data.category
          globalThis.newFeedRetryReads[category] = (globalThis.newFeedRetryReads[category] ?? 0) + 1
          if (!request.data.cursor && failures.delete(category)) throw new Error('simulated first category read failure')
        }
        return handler(event, request)
      })
    })
    await goTo(page, 'subscriptions')
    await page.getByRole('tab', { name: 'New', exact: true }).click()
    const feed = page.locator('.newFeed')
    await expect(feed.getByRole('alert')).toHaveCount(3)
    await expect(feed.getByText('No new content', { exact: true })).toHaveCount(0)
    const screenshot = testInfo.outputPath('combined-new-category-retry-95.png')
    await feed.screenshot({ path: screenshot })
    await testInfo.attach('combined New feed category Retry at 95%', { path: screenshot, contentType: 'image/png' })
    for (const [category, { field, title, records }] of Object.entries(categories)) {
      const before = await app.electronApp.evaluate(() => globalThis.newFeedRetryReads)
      const section = feed.locator(`[data-new-feed-category="${category}"]`)
      await section.getByRole('button', { name: 'Retry', exact: true }).click()
      await expect(section.getByRole('alert')).toHaveCount(0)
      await expect(section).toContainText(title)
      expect(await app.electronApp.evaluate(() => globalThis.newFeedRetryReads)).toStrictEqual({ ...before, [category]: before[category] + 1 })
      expect(await page.evaluate(({ channelId, field, ids }) => window.ftElectron.libraryQuery('subscriptionEntries', { channelId, field, ids }), { channelId, field, ids: records.map(record => record.videoId ?? record.postId) })).toStrictEqual(records)
    }
  })

  test('combined New category badges survive a failed primary read', async ({ app, page }) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await app.electronApp.evaluate(({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('library-query')
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', (event, request) => {
        if (request.method === 'subscriptionPage' && request.data.onlyNew && request.data.category === 'videos') throw new Error('simulated primary read failure')
        return handler(event, request)
      })
    })
    await goTo(page, 'subscriptions')
    await page.getByRole('tab', { name: 'New', exact: true }).click()
    for (const [category, { title }] of Object.entries(categories)) {
      const section = page.locator(`[data-new-feed-category="${category}"]`)
      await section.scrollIntoViewIfNeeded()
      await expect(section).toContainText(title)
    }
    await expect.poll(() => page.evaluate(() => {
      const find = vnode => {
        if (vnode?.component?.exposed?.hasNewContentByCategory) {
          const counts = vnode.component.exposed.hasNewContentByCategory
          return counts.value ?? counts
        }
        const nested = vnode?.component?.subTree && find(vnode.component.subTree)
        if (nested) return nested
        for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
          const result = find(child)
          if (result) return result
        }
        return null
      }
      return find(document.querySelector('#app').__vue_app__._container._vnode)
    })).toStrictEqual({ videos: false, shorts: true, live: true, posts: true })
  })

  test.describe('scheduled library premiere', () => {
    test.use({
      // Playwright requires destructuring even when this seed has no dependencies.
      seed: async ({}, use) => { // eslint-disable-line no-empty-pattern
        const premiere = { _id: 'clock-premiere', videoId: 'abcdefghijk', title: 'Partially watched clock premiere', author: 'Example channel', type: 'video', timeWatched: 1, isUpcoming: true, premiereTimestamp: (Date.now() + 30000) / 1000, lengthSeconds: 100, watchProgress: 10, isWatched: false, unknown: { keep: true } }
        await use({ settings: { historyWatchedStatusMigrated: true, currentLocale: 'en_US', uiScale: 95, landingPage: 'history' }, history: [premiere], playlists: [], watchStats: [{ _id: 'history-watch-time-v1' }] })
      },
    })
    test('revisiting Home discovers a started premiere without changing its saved progress', async ({ page }) => {
      test.setTimeout(60000)
      const premiere = (await page.evaluate(() => window.ftElectron.libraryQuery('videoState', { ids: ['abcdefghijk'] }))).history[0]
      await goTo(page, 'home')
      await expect(page.getByText(premiere.title, { exact: true })).toHaveCount(0)
      await goTo(page, 'history')
      await expect.poll(() => page.evaluate(timestamp => Date.now() >= timestamp * 1000, premiere.premiereTimestamp), { timeout: 35000 }).toBe(true)
      await goTo(page, 'home')
      await expect(page.locator('[data-home-section="continueWatching"]')).toContainText(premiere.title)
      expect((await page.evaluate(() => window.ftElectron.libraryQuery('videoState', { ids: ['abcdefghijk'] }))).history).toStrictEqual([premiere])
    })
  })

  for (const format of ['history', 'youtubeHistory', 'playlists']) {
    for (const failure of ['read', 'write']) {
      test(`${format} export reports a ${failure} failure and aborts its unfinished backup`, async ({ app, page }) => {
        const section = await goToSettingsSection(page, 'data')
        await app.electronApp.evaluate(({ ipcMain }, failure) => {
          globalThis.exportCancellations = 0
          const handler = ipcMain._invokeHandlers.get('library-query')
          ipcMain.removeHandler('library-query')
          ipcMain.handle('library-query', (event, request) => {
            if (request.method === 'exportCancel') globalThis.exportCancellations++
            if (failure === 'read' && request.method === 'exportNext') throw new Error('simulated export read failure')
            return handler(event, request)
          })
        }, failure)
        await page.evaluate(failure => {
          window.exportAborted = false
          window.exportClosed = false
          window.showSaveFilePicker = async () => ({
            createWritable: async () => ({
              async write() { if (failure === 'write') throw new Error('simulated disk full') },
              async abort() { window.exportAborted = true },
              async close() { window.exportClosed = true },
            })
          })
        }, failure)
        if (format === 'playlists') await section.getByRole('button', { name: 'Export Playlists', exact: true }).click()
        else {
          await section.getByRole('button', { name: 'Export History', exact: true }).click()
          await page.locator('.settingsSubpageContent').getByRole('button', { name: format === 'history' ? /Export OpenTubeX/ : /Export YouTube/ }).click()
        }
        await expect(page.locator('.toast')).toContainText('Unable to write file')
        expect(await page.evaluate(() => ({ aborted: window.exportAborted, closed: window.exportClosed }))).toStrictEqual({ aborted: true, closed: false })
        expect(await app.electronApp.evaluate(() => globalThis.exportCancellations)).toBe(1)
        expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))).toStrictEqual(saved)
      })
    }
  }
})

for (const backendPreference of ['local', 'invidious']) {
  test.describe(`downloaded playback with pending ${backendPreference} history hydration`, () => {
    const videoId = 'offline0001'
    const mediaPath = path.join(repoRoot, 'e2e/fixtures/media/demo.webm')
    const savedHistory = {
      _id: 'saved-download',
      videoId,
      title: 'Offline download',
      author: 'Saved author',
      timeWatched: 1,
      lengthSeconds: 30,
      watchProgress: 2,
      isWatched: true,
      unknownLegacyField: { keep: true },
      lastViewedPlaylistId: 'retained-context',
      lastViewedPlaylistType: 'user',
      lastViewedPlaylistItemId: 'retained-member',
    }
    test.use({
      seed: {
        settings: { landingPage: 'history', historyWatchedStatusMigrated: true, enableDownloads: true, backendPreference, uiScale: 95, saveVideoHistoryWithLastViewedPlaylist: false },
        history: [savedHistory],
        playlists: [],
        watchStats: [{ _id: 'history-watch-time-v1' }],
        downloads: [{
          id: 1,
          videoId,
          title: 'Offline download',
          status: 'completed',
          mode: 'video',
          percent: 100,
          destination: mediaPath,
          destinations: [mediaPath],
          files: [{ videoId, path: mediaPath, extension: 'webm', duration: 30 }],
        }],
      },
    })

    test('losing connectivity waits for saved history before playback and keeps saving progress', async ({ app, page }) => {
      const readHistory = () => page.evaluate(({ action, videoId }) => window.ftElectron.dbHistory(action, { videoId }), { action: DBActions.GENERAL.FIND, videoId })
      expect(await readHistory()).toStrictEqual([savedHistory])
      await app.electronApp.evaluate(({ ipcMain }, videoId) => {
        const handler = ipcMain._invokeHandlers.get('library-query')
        const ready = new Promise(resolve => { globalThis.sqliteDownloadHistoryRelease = resolve })
        globalThis.sqliteDownloadHistoryWaiting = false
        ipcMain.removeHandler('library-query')
        ipcMain.handle('library-query', async (event, request) => {
          if (request.method === 'videoState' && request.data.ids.includes(videoId)) {
            globalThis.sqliteDownloadHistoryWaiting = true
            await ready
          }
          return handler(event, request)
        })
      }, videoId)
      await page.route(/^https?:\/\//, route => route.fulfill({ status: route.request().url().includes('/generate_204') ? 204 : 404, body: '' }))
      await page.evaluate(videoId => window.ftElectron.tabs.create({ route: `/watch/${videoId}?downloadId=1`, makeActive: true }), videoId)
      await expect.poll(() => app.electronApp.evaluate(() => globalThis.sqliteDownloadHistoryWaiting)).toBe(true)
      const view = await watchViewHandle(page)
      const generation = await view.evaluate(watch => watch.videoLoadGeneration)
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
        window.dispatchEvent(new Event('offline'))
      })
      await expect.poll(() => view.evaluate(watch => watch.isOffline)).toBe(true)
      expect(await view.evaluate(watch => ({ generation: watch.videoLoadGeneration, local: watch.localFilePlayback, hydrated: watch.historyHydratedVideoId }))).toStrictEqual({ generation, local: false, hydrated: null })
      await expect(page.locator('.video-js')).toHaveCount(0)
      expect(await readHistory()).toStrictEqual([savedHistory])
      await app.electronApp.evaluate(() => globalThis.sqliteDownloadHistoryRelease())
      const video = page.locator('video').first()
      await expect(video).toBeVisible()
      await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
      await expect.poll(() => view.evaluate(watch => watch.historyHydratedVideoId)).toBe(videoId)
      await video.evaluate(element => element.play())
      await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(2)
      await video.evaluate(element => element.pause())
      await expect.poll(() => view.evaluate(watch => watch.$refs.player.hasPlaybackPosition)).toBe(true)
      const [beforeSave] = await readHistory()
      for (const field of ['isWatched', 'unknownLegacyField', 'lastViewedPlaylistId', 'lastViewedPlaylistType', 'lastViewedPlaylistItemId']) {
        expect(beforeSave[field]).toStrictEqual(savedHistory[field])
      }
      await video.evaluate(element => { element.currentTime = 12 })
      await expect.poll(() => video.evaluate(element => element.currentTime)).toBe(12)
      await view.evaluate(watch => watch._saveWatchProgress())
      await expect.poll(readHistory).toStrictEqual([{ ...beforeSave, watchProgress: 12 }])
      await page.evaluate(async () => {
        const { activeTabId } = await window.ftElectron.tabs.getState()
        await window.ftElectron.tabs.close(activeTabId)
      })
      await expect(page).not.toHaveURL(new RegExp(`/watch/${videoId}`))
      expect(await readHistory()).toStrictEqual([{ ...beforeSave, watchProgress: 12 }])
    })
  })
}

test.use({
  seed: {
    settings: { historyWatchedStatusMigrated: true, uiScale: 95, generalAutoLoadMorePaginatedItemsEnabled: false, userPlaylistSortOrder: 'custom', currentLocale: 'en_US', externalPlayerCustomArgs: '--play;--quit' },
    history,
    playlists: [playlist],
    watchStats: [{ _id: 'history-watch-time-v1' }],
  }
})

test('library worker rejects internal helpers and inherited targets while retaining authorized reads and writes', async ({ app, page }) => {
  const result = await app.electronApp.evaluate(async (_, workerPath) => {
    const { Worker } = process.getBuiltinModule('node:worker_threads')
    const fs = process.getBuiltinModule('node:fs/promises')
    const { tmpdir } = process.getBuiltinModule('node:os')
    const { join } = process.getBuiltinModule('node:path')
    const directory = await fs.mkdtemp(join(tmpdir(), 'opentubex-worker-dispatch-'))
    const worker = new Worker(workerPath, { workerData: { directory } })
    let id = 0
    const request = (target, method, args = []) => new Promise((resolve, reject) => {
      worker.once('error', reject)
      worker.once('message', response => { worker.off('error', reject); resolve(response) })
      worker.postMessage({ id: ++id, target, method, args })
    })
    try {
      const denied = []
      denied.push(await request('engine', 'updateSubscriptionFeed', [{ channelId: 'hidden', entries: [{ videoId: 'hidden' }], timestamp: 1, field: 'videos' }]))
      denied.push(await request('engine', 'updateSubscriptionShortsMetadata', [{ channelId: 'hidden', entries: [] }]))
      denied.push(await request('handler:settings', 'toString'))
      denied.push(await request('handler:constructor', 'toString'))
      denied.push(await request('collection:constructor', 'findOneAsync', [{}]))
      denied.push(await request('collection:__proto__', 'countAsync', [{}]))
      const before = await request('collection:subscriptionCache', 'countAsync', [{}])
      const inserted = await request('collection:history', 'insertAsync', [{ _id: 'allowed', videoId: 'allowed', timeWatched: 1, unknown: { keep: true } }])
      const read = await request('collection:history', 'findOneAsync', [{ _id: 'allowed' }])
      const summary = await request('engine', 'historySummary', [{}])
      const setting = await request('handler:settings', 'upsert', ['workerDispatch', true])
      const storedSetting = await request('collection:settings', 'findOneAsync', [{ _id: 'workerDispatch' }])
      const feed = await request('handler:subscriptionCache', 'updateVideosByChannelId', ['allowed-channel', [{ videoId: 'feed-entry', title: 'Allowed entry' }], new Date(1)])
      const entries = await request('engine', 'subscriptionEntries', [{ channelId: 'allowed-channel', ids: ['feed-entry'] }])
      return { denied: denied.map(response => response.error?.message ?? 'unexpected success'), before, inserted, read, summary, setting, storedSetting, feed, entries }
    } finally {
      await worker.terminate()
      await fs.rm(directory, { recursive: true, force: true })
    }
  }, path.join(repoRoot, 'dist-e2e/libraryWorker.js'))
  expect(result.denied).toEqual([
    'Unknown library request', 'Unknown library request', 'Unknown library handler', 'Unknown library handler',
    'Unknown library collection', 'Unknown library collection',
  ])
  expect(result.before.result).toBe(0)
  expect(result.inserted.error).toBeUndefined()
  expect(result.read.result).toStrictEqual({ _id: 'allowed', videoId: 'allowed', timeWatched: 1, unknown: { keep: true } })
  expect(result.summary.error).toBeUndefined()
  expect(result.setting.error).toBeUndefined()
  expect(result.storedSetting.result).toStrictEqual({ _id: 'workerDispatch', value: true })
  expect(result.feed.result).toBe(true)
  expect(result.entries.result).toStrictEqual([{ videoId: 'feed-entry', title: 'Allowed entry', isNewInSubscriptionFeed: false }])
  const renderer = await page.evaluate(async () => {
    const history = await window.ftElectron.libraryQuery('historyPage')
    const canceled = []
    const denied = []
    const startupDenied = []
    for (const method of ['_findOne', '_findAppReadyRelatedSettings', 'loadAll']) {
      try { await window.ftElectron.libraryQuery(method); startupDenied.push('unexpected success') } catch (error) { startupDenied.push(error.message) }
    }
    for (const data of [undefined, null, {}]) {
      canceled.push(await window.ftElectron.libraryQuery('importCancel', data))
      try { await window.ftElectron.libraryQuery('importApply', data); denied.push('unexpected success') } catch (error) { denied.push(error.message) }
    }
    return { total: history.total, canceled, denied, startupDenied }
  })
  expect(renderer.total).toBe(history.length)
  expect(renderer.canceled).toStrictEqual([true, true, true])
  expect(renderer.denied).toHaveLength(3)
  for (const error of renderer.denied) expect(error).toContain('does not belong to this window')
  expect(renderer.startupDenied).toHaveLength(3)
  for (const error of renderer.startupDenied) expect(error).toContain('Unknown library query')
})

test.describe('playlist content search recovery', () => {
  test.use({
    seed: {
      settings: { historyWatchedStatusMigrated: true, uiScale: 95, currentLocale: 'en_US', userPlaylistSortOrder: 'custom' },
      history,
      playlists: [playlist, { _id: 'other-search-playlist', playlistName: 'Other playlist', videos: [] }],
      watchStats: [{ _id: 'history-watch-time-v1' }],
    }
  })
  test('failed playlist content search offers Retry without hiding retained matches at 95% scale', async ({ app, page }, testInfo) => {
    const original = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))
    await app.electronApp.evaluate(({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('library-query')
      let fail = true
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', (event, request) => {
        if (request.method === 'playlistSelection' && fail) { fail = false; throw new Error('simulated content search failure') }
        return handler(event, request)
      })
    })
    await goTo(page, 'userplaylists')
    await page.locator('.matchingVideosToggle label').click()
    await page.locator('.playlistSearch input').fill('Playlist entry 19999')
    const error = page.locator('.playlistSearchError')
    await expect(error.getByRole('alert')).toBeVisible()
    await expect(page.locator('.card .message')).toHaveCount(1)
    const screenshot = testInfo.outputPath('playlist-content-search-retry-95.png')
    await page.locator('.card').filter({ has: error }).screenshot({ path: screenshot })
    await testInfo.attach('playlist content search Retry at 95%', { path: screenshot, contentType: 'image/png' })
    await error.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(error).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Large legacy playlist', exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))).toStrictEqual(original)
  })
})

test('a failed paged playlist load offers Retry and restores the unchanged library at 95% scale', async ({ app, page }, testInfo) => {
  const original = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))
  await app.electronApp.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('library-query')
    if (!handler) throw new Error('Missing library IPC handler')
    let fail = true
    ipcMain.removeHandler('library-query')
    ipcMain.handle('library-query', (event, request) => {
      if (request.method === 'playlistPage' && fail) { fail = false; throw new Error('simulated playlist page failure') }
      return handler(event, request)
    })
  })
  await goTo(page, 'userplaylists')
  await page.getByText('Large legacy playlist').click()
  const retry = page.getByRole('button', { name: 'Retry', exact: true })
  await expect(retry).toBeVisible()
  await expect(page.locator('.playlistErrorState')).toContainText('This playlist could not be loaded.')
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    const screenshot = testInfo.outputPath(`playlist-page-load-retry-95-${theme}.png`)
    await page.locator('.playlistErrorState .errorStateContent').screenshot({ path: screenshot })
    await testInfo.attach(`playlist-page-load-retry-95-${theme}`, { path: screenshot, contentType: 'image/png' })
  }
  await retry.click()
  await expect(page.locator('.playlistItemsCard [data-playlist-drag-item]')).toHaveCount(100)
  await expect(page.locator('.playlistErrorState')).toHaveCount(0)
  expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))).toStrictEqual(original)
})

test('playlist search reports no matches and clears a previous paging error after reload', async ({ app, page }) => {
  await goTo(page, 'userplaylists')
  await page.getByRole('link', { name: 'Large legacy playlist', exact: true }).click()
  const card = page.locator('.playlistItemsCard')
  await expect(card.locator('[data-playlist-drag-item]')).toHaveCount(100)
  await app.electronApp.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('library-query')
    let fail = true
    ipcMain.removeHandler('library-query')
    ipcMain.handle('library-query', (event, request) => {
      if (request.method === 'playlistPage' && request.data.cursor && fail) { fail = false; throw new Error('simulated next playlist page failure') }
      return handler(event, request)
    })
  })
  await card.getByRole('button', { name: 'Load More Videos', exact: true }).click()
  await expect(card.locator('.paginationErrorState')).toBeVisible()
  const search = page.getByRole('searchbox', { name: 'Search for Videos', exact: true })
  await search.fill('No matching library entry')
  await expect(card).toContainText('There are no videos in this playlist that match your search')
  await search.fill('Playlist entry')
  await expect(card.getByRole('heading', { name: 'Playlist entry 0', exact: true })).toBeVisible()
  await expect(card.locator('[data-feed-item-key]')).toHaveCount(100)
  await expect(card.locator('.paginationErrorState')).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Load More Videos', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))).toStrictEqual(playlist)
})

test('history read failure offers Retry without presenting missing data or changing durable records', async ({ app, page }, testInfo) => {
  await app.electronApp.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('library-query')
    let fail = true
    ipcMain.removeHandler('library-query')
    ipcMain.handle('library-query', (event, request) => {
      if (request.method === 'historyPage' && fail) { fail = false; throw new Error('simulated history read failure') }
      return handler(event, request)
    })
  })
  await goTo(page, 'history')
  const retry = page.getByRole('button', { name: 'Retry', exact: true })
  await expect(retry).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Could not load app data')
  await expect(page.getByText('There are no videos in your history that match your search', { exact: true })).toHaveCount(0)
  const screenshot = testInfo.outputPath('history-read-retry-95.png')
  await page.locator('.card').screenshot({ path: screenshot })
  await testInfo.attach('history-read-retry-95', { path: screenshot, contentType: 'image/png' })
  await retry.click()
  await expect(retry).toHaveCount(0)
  await expect(page.locator('.historySearch')).toBeVisible()
  expect((await page.evaluate(() => window.ftElectron.libraryQuery('historyPage', { limit: 100 }))).records).toStrictEqual(history.toReversed().slice(0, 100))
  await app.electronApp.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('library-query')
    let fail = true
    ipcMain.removeHandler('library-query')
    ipcMain.handle('library-query', (event, request) => {
      if (request.method === 'historyPage' && request.data.cursor && fail) { fail = false; throw new Error('simulated next history page failure') }
      return handler(event, request)
    })
  })
  await page.getByRole('button', { name: 'Load More Videos', exact: true }).click()
  await expect(retry).toBeVisible()
  await expect(page.locator('[data-feed-item-key]')).toHaveCount(100)
  await retry.click()
  await expect(retry).toHaveCount(0)
  await expect(page.locator('[data-feed-item-key]')).toHaveCount(200)
  expect((await page.evaluate(() => window.ftElectron.libraryQuery('historyPage', { limit: 250 }))).records).toStrictEqual(history.toReversed().slice(0, 250))
})

test('a failed History refresh clamps its changed scroll range while retaining loaded records at fractional scale', async ({ app, page }, testInfo) => {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', 95))
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
  await goTo(page, 'history')
  const content = page.locator('.tabContent[aria-hidden="false"] .historySearch').locator('xpath=..')
  const cards = content.locator('.autoGrid > *')
  await expect(cards).toHaveCount(100)
  for (const count of [200, 300]) {
    await content.getByRole('button', { name: 'Load More Videos' }).click()
    await expect(cards).toHaveCount(count)
  }
  await expect.poll(() => page.evaluate(() => {
    document.activeElement?.blur()
    window.scrollTo(0, Number.MAX_SAFE_INTEGER)
    return window.scrollY
  })).toBeGreaterThan(500)
  await app.electronApp.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('library-query')
    globalThis.historyRefreshHandler = handler
    ipcMain.removeHandler('library-query')
    ipcMain.handle('library-query', (event, request) => {
      if (request.method === 'historyPage') throw new Error('simulated scrolled history refresh failure')
      return handler(event, request)
    })
  })
  await page.clock.setFixedTime(new Date(history[50].timeWatched + 24 * 60 * 60 * 1000))
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.state.settings.historyRetentionDays = 1
    await store.dispatch('grabHistory')
  })
  await expect(page.getByRole('alert')).toContainText('Could not load app data')
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await expect(cards).toHaveCount(300)
  await expectDocumentScrollToMatchContent(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  const screenshot = testInfo.outputPath('history-failed-refresh-scroll-95.png')
  await page.screenshot({ path: screenshot, animations: 'disabled' })
  await testInfo.attach('history-failed-refresh-scroll-95', { path: screenshot, contentType: 'image/png' })
  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('library-query')
    ipcMain.handle('library-query', globalThis.historyRefreshHandler)
    delete globalThis.historyRefreshHandler
  })
  expect((await page.evaluate(() => window.ftElectron.libraryQuery('historySummary'))).total).toBe(history.length - 50)
  expect((await page.evaluate(() => window.ftElectron.libraryQuery('historyPage', { limit: 250 }))).records).toStrictEqual(history.toReversed().slice(0, 250))
})

test('failed saved-history hydration stops playback and leaves durable progress and context unchanged', async ({ app, page }) => {
  const id = history[190].videoId
  await page.evaluate(({ action, record }) => window.ftElectron.dbHistory(action, record), {
    action: DBActions.GENERAL.UPSERT,
    record: { ...history[190], isWatched: true, lastViewedPlaylistId: 'large', lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: 'duplicate-legacy-id' },
  })
  const before = (await page.evaluate(id => window.ftElectron.libraryQuery('videoState', { ids: [id] }), id)).history
  await app.electronApp.evaluate(({ ipcMain }, id) => {
    const handler = ipcMain._invokeHandlers.get('library-query')
    globalThis.sqliteHistoryQueryRestore = () => {
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', handler)
    }
    ipcMain.removeHandler('library-query')
    ipcMain.handle('library-query', (event, request) => {
      if (request.method === 'videoState' && request.data.ids.includes(id)) throw new Error('simulated saved-history failure')
      return handler(event, request)
    })
  }, id)
  await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
  await page.evaluate(id => window.ftElectron.tabs.create({ route: `/watch/${id}`, makeActive: true }), id)
  await expect(page.locator('.videoPlayerError .errorMessage')).toContainText('simulated saved-history failure')
  await expect(page.locator('.video-js')).toHaveCount(0)
  // Closing Watch exercises its final progress-save lifecycle too.
  await page.evaluate(async () => {
    const { activeTabId } = await window.ftElectron.tabs.getState()
    await window.ftElectron.tabs.close(activeTabId)
  })
  await expect(page).not.toHaveURL(new RegExp(`/watch/${id}`))
  await app.electronApp.evaluate(() => {
    globalThis.sqliteHistoryQueryRestore()
    delete globalThis.sqliteHistoryQueryRestore
  })
  expect((await page.evaluate(id => window.ftElectron.libraryQuery('videoState', { ids: [id] }), id)).history).toStrictEqual(before)
})

test('plays a bounded window of a large playlist using stable identity despite duplicate legacy item IDs', async ({ page }) => {
  await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
  const item = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', offset: 190, limit: 1 })).records[0])
  await page.evaluate(item => window.ftElectron.tabs.create({ route: `/watch/${item.videoId}?playlistId=large&playlistType=user&playlistItemId=${item.playlistItemId}&libraryMemberId=${item._libraryMemberId}`, makeActive: true }), item)
  const playerPlaylist = page.locator('.watchVideoPlaylist.resizablePlaylist')
  await expect(playerPlaylist.locator('.playlistIndex label')).toHaveText('191 / 20000')
  await expect(playerPlaylist.locator('.playlistItem')).toHaveCount(100)
  await playerPlaylist.getByText('Playlist entry 191', { exact: true }).click()
  await expect(playerPlaylist.locator('.playlistIndex label')).toHaveText('192 / 20000')
  expect((await residentState(page)).playlistRows).toBe(0)
})

for (const rejects of [false, true]) {
  test(`playlist skip controls recover after a navigation guard ${rejects ? 'rejects' : 'blocks'}`, async ({ page }) => {
    await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
    const before = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))
    const item = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', offset: 190, limit: 1 })).records[0])
    await page.evaluate(item => window.ftElectron.tabs.create({ route: `/watch/${item.videoId}?playlistId=large&playlistType=user&playlistItemId=${item.playlistItemId}&libraryMemberId=${item._libraryMemberId}`, makeActive: true }), item)
    const playerPlaylist = page.locator('.watchVideoPlaylist.resizablePlaylist')
    await expect(playerPlaylist.locator('.playlistIndex label')).toHaveText('191 / 20000')
    const view = await watchViewHandle(page)
    await expect.poll(() => view.evaluate(watch => watch.canSkipToNextVideo)).toBe(true)
    await view.evaluate((watch, rejects) => {
      const router = watch.tabRouter
      globalThis.sqliteNavigationGuardRemove = router.beforeEach(() => new Promise((resolve, reject) => {
        globalThis.sqliteNavigationGuardFinish = () => rejects ? reject(new Error('simulated rejected navigation')) : resolve(false)
      }))
    }, rejects)
    await view.evaluate(watch => watch.handleSkipToNext())
    await expect.poll(() => view.evaluate(watch => watch.canSkipToNextVideo)).toBe(false)
    await page.evaluate(() => { globalThis.sqliteNavigationGuardFinish(); globalThis.sqliteNavigationGuardRemove() })
    await expect.poll(() => view.evaluate(watch => watch.canSkipToNextVideo)).toBe(true)
    await expect(playerPlaylist.locator('.playlistIndex label')).toHaveText('191 / 20000')
    await view.evaluate(watch => watch.handleSkipToNext())
    await expect(playerPlaylist.locator('.playlistIndex label')).toHaveText('192 / 20000')
    expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))).toStrictEqual(before)
  })
}

test('playlist skip actions retain mounted cards while waiting and stay disabled after a failed read', async ({ app, page }, testInfo) => {
  await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
  const item = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', offset: 190, limit: 1 })).records[0])
  await page.evaluate(item => window.ftElectron.tabs.create({ route: `/watch/${item.videoId}?playlistId=large&playlistType=user&playlistItemId=${item.playlistItemId}&libraryMemberId=${item._libraryMemberId}`, makeActive: true }), item)
  await expect(page.locator('.playlistIndex label')).toHaveText('191 / 20000')
  const view = await watchViewHandle(page)
  await expect.poll(() => view.evaluate(watch => watch.canSkipToNextVideo)).toBe(true)
  await page.locator('.watchVideoPlaylist.resizablePlaylist .playlistHeader').evaluate(header => { globalThis.retainedPlaylistHeader = header })
  await app.electronApp.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('library-query')
    ipcMain.removeHandler('library-query')
    const pending = []
    globalThis.sqliteSkipWindowFinish = () => { for (const reject of pending.splice(0)) reject(new Error('simulated window failure')) }
    ipcMain.handle('library-query', async (event, request) => {
      if (request.method === 'playlistWindow') await new Promise((resolve, reject) => pending.push(reject))
      return handler(event, request)
    })
  })
  await page.locator('.watchVideoPlaylist.resizablePlaylist').getByText('Playlist entry 191', { exact: true }).click()
  await expect.poll(() => view.evaluate(watch => ({ next: watch.canSkipToNextVideo, previous: watch.canSkipToPreviousVideo }))).toStrictEqual({ next: false, previous: false })
  await expect(page.locator('.watchVideoPlaylist.resizablePlaylist .playlistItem')).toHaveCount(100)
  expect(await page.locator('.watchVideoPlaylist.resizablePlaylist .playlistHeader').evaluate(header => header === globalThis.retainedPlaylistHeader)).toBe(true)
  await app.electronApp.evaluate(() => { globalThis.sqliteSkipWindowFinish(); delete globalThis.sqliteSkipWindowFinish })
  await expect(page.getByText('This playlist could not be loaded.', { exact: true })).toBeVisible()
  expect(await view.evaluate(watch => ({ next: watch.canSkipToNextVideo, previous: watch.canSkipToPreviousVideo }))).toStrictEqual({ next: false, previous: false })
  expect(await page.locator('.watchVideoPlaylist.resizablePlaylist .playlistHeader').evaluate(header => header === globalThis.retainedPlaylistHeader)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('playlist-cards-retained-after-read-failure.png') })
})

async function residentState(page) {
  return page.evaluate(() => {
    const state = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state
    return {
      paged: state.history.libraryPaged,
      total: state.history.historyTotal,
      historyRows: state.history.historyCacheSorted.length,
      playlistRows: state.playlists.playlists.reduce((count, playlist) => count + playlist.videos.length, 0),
      largeCount: state.playlists.playlists.find(playlist => playlist._id === 'large')?.videoCount
    }
  })
}

test('reordering the first playlist member refreshes the summary and play link together', async ({ page }) => {
  await goTo(page, 'userplaylists')
  await page.getByText('Large legacy playlist', { exact: true }).click()
  const rows = page.locator('.playlistItemsCard [data-playlist-drag-item]')
  await expect(rows).toHaveCount(100)
  // Start on the draggable wrapper; its center can pick up a nested link.
  await rows.nth(1).dragTo(rows.nth(0), { sourcePosition: { x: 2, y: 2 }, targetPosition: { x: 2, y: 2 } })
  await expect(rows.nth(0).locator('.h3Title')).toHaveText('Playlist entry 1')
  const link = page.locator('.playlistInfo .playlistThumbnail a')
  await expect(link).toHaveAttribute('href', /#\/watch\/v0000000001\?/)
  const summary = (await page.evaluate(() => window.ftElectron.libraryQuery('playlistSummaries'))).find(item => item._id === 'large')
  expect(summary.firstVideo).toStrictEqual(playlist.videos[1])
  expect((await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))).videos).toStrictEqual([playlist.videos[1], playlist.videos[0], ...playlist.videos.slice(2)])
})

for (const layout of ['grid', 'list']) {
  for (const legacyId of [null, 'repeated']) {
    test.describe(`legacy member drag in ${layout} with ${legacyId ?? 'missing'} item IDs`, () => {
      const videos = ['first', 'middle', 'last'].map(title => ({ videoId: 'abcdefghijk', ...(legacyId === null ? {} : { playlistItemId: legacyId }), title, author: 'Example', type: 'video', unknownLegacyField: { title } }))
      test.use({ seed: { settings: { historyWatchedStatusMigrated: true, uiScale: 95, playlistViewType: layout, userPlaylistSortOrder: 'custom', currentLocale: 'en_US' }, history: [], playlists: [{ _id: 'legacy-drag', playlistName: 'Duplicate legacy members', createdAt: 1, lastUpdatedAt: 1, videos }] } })
      for (const interaction of ['native', 'touch']) {
        test(`${interaction} drag moves the exact retained occurrence`, async ({ page }) => {
          await page.setViewportSize({ width: layout === 'grid' ? 900 : 430, height: 1000 })
          await goTo(page, 'userplaylists')
          await page.getByText('Duplicate legacy members').click()
          const rows = page.locator('.playlistItemsCard [data-playlist-drag-item]')
          await expect(rows).toHaveCount(3)
          const original = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistPage', { id: 'legacy-drag' })).records)
          if (interaction === 'native') {
            await rows.nth(2).dragTo(rows.nth(1), { sourcePosition: { x: 2, y: 2 }, targetPosition: { x: 2, y: 2 } })
            await expect(rows.nth(1).locator('.h3Title')).toHaveText('last')
          } else {
            const session = await page.context().newCDPSession(page)
            await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
            // Coordinate input needs the initial layout to settle.
            await rows.nth(2).locator('.grabBar').click({ trial: true })
            const from = await rows.nth(2).locator('.grabBar').boundingBox()
            const to = await rows.nth(1).boundingBox()
            if (!from || !to) throw new Error('The playlist touch drag source and target must be visible')
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: from.x + from.width / 2, y: from.y + from.height / 2 }] })
            await expect(rows.nth(2)).toHaveClass(/pointerDragging/)
            await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: to.x + to.width / 2, y: to.y + to.height / 2 }] })
            await expect(rows.nth(1).locator('.h3Title')).toHaveText('last')
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
            await session.detach()
          }
          await expect.poll(() => page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistPage', { id: 'legacy-drag' })).records)).toStrictEqual([original[0], original[2], original[1]])
          expect((await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'legacy-drag' }))).videos).toStrictEqual([videos[0], videos[2], videos[1]])
          await expect(page.locator('.pointerDragging, .draggedVideo')).toHaveCount(0)
        })
        if (layout === 'list' && interaction === 'native') {
          test('Watch Shuffle hides reordering and preserves the durable custom order', async ({ page }, testInfo) => {
            await page.setViewportSize({ width: 1300, height: 1000 })
            await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
            const originalSnapshot = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'legacy-drag' }))
            const original = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistPage', { id: 'legacy-drag' })).records)
            await page.evaluate(item => window.ftElectron.tabs.create({ route: `/watch/${item.videoId}?playlistId=legacy-drag&playlistType=user&libraryMemberId=${item._libraryMemberId}`, makeActive: true }), original[0])
            const panel = page.locator('.watchVideoPlaylist')
            const rows = panel.locator('[data-playlist-drag-item]')
            await expect(rows).toHaveCount(3)
            await expect(rows.nth(2).locator('.grabBar')).toBeVisible()
            await panel.getByRole('button', { name: 'Shuffle Playlist', exact: true }).click()
            await expect(panel.getByRole('button', { name: 'Shuffle Playlist', exact: true })).toHaveAttribute('aria-pressed', 'true')
            await expect(panel.locator('.grabBar')).toHaveCount(0)
            await expect(panel.getByTitle('Move Video Up', { exact: true })).toHaveCount(0)
            await expect(panel.getByTitle('Move Video Down', { exact: true })).toHaveCount(0)
            expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'legacy-drag' }))).toStrictEqual(originalSnapshot)
            await panel.screenshot({ path: testInfo.outputPath('watch-shuffle-reordering-disabled-95.png') })
            await panel.getByRole('button', { name: 'Shuffle Playlist', exact: true }).click()
            await expect(rows.nth(2).locator('.grabBar')).toBeVisible()
            expect(await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistPage', { id: 'legacy-drag' })).records)).toStrictEqual(original)
          })
        }
        if (layout === 'list') {
          test(`Watch ${interaction} drag moves the exact retained occurrence`, async ({ page }) => {
            await page.setViewportSize({ width: 1300, height: 1000 })
            await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
            const original = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistPage', { id: 'legacy-drag' })).records)
            await page.evaluate(item => window.ftElectron.tabs.create({ route: `/watch/${item.videoId}?playlistId=legacy-drag&playlistType=user&libraryMemberId=${item._libraryMemberId}`, makeActive: true }), original[0])
            const rows = page.locator('.watchVideoPlaylist [data-playlist-drag-item]')
            await expect(rows).toHaveCount(3)
            if (interaction === 'native') {
              await rows.nth(2).dragTo(rows.nth(1), { sourcePosition: { x: 2, y: 2 }, targetPosition: { x: 2, y: 2 } })
              await expect(rows.nth(1).locator('.h3Title')).toHaveText('last')
            } else {
              const session = await page.context().newCDPSession(page)
              await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
              await rows.nth(2).locator('.grabBar').click({ trial: true })
              const from = await rows.nth(2).locator('.grabBar').boundingBox()
              const to = await rows.nth(1).boundingBox()
              if (!from || !to) throw new Error('The Watch playlist touch drag source and target must be visible')
              await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: from.x + from.width / 2, y: from.y + from.height / 2 }] })
              await expect(rows.nth(2)).toHaveClass(/pointerDragging/)
              await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: to.x + to.width / 2, y: to.y + to.height / 2 }] })
              await expect(rows.nth(1).locator('.h3Title')).toHaveText('last')
              await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
              await session.detach()
            }
            await expect.poll(() => page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistPage', { id: 'legacy-drag' })).records)).toStrictEqual([original[0], original[2], original[1]])
            expect((await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'legacy-drag' }))).videos).toStrictEqual([videos[0], videos[2], videos[1]])
            await expect(page.locator('.pointerDragging, .draggedVideo')).toHaveCount(0)
          })
        }
      }
    })
  }
  test.describe(`paged playlist reorder controls in ${layout}`, () => {
    test.use({
      seed: {
        settings: { historyWatchedStatusMigrated: true, uiScale: 125, playlistViewType: layout, generalAutoLoadMorePaginatedItemsEnabled: false, userPlaylistSortOrder: 'custom', currentLocale: 'en_US' },
        history: [],
        playlists: [{ ...playlist, protected: false, videos: playlist.videos.slice(0, 105) }],
      }
    })

    test(`keeps ${layout} reorder actions at loaded page boundaries and hides them at the true end`, async ({ page, attachScreenshot }) => {
      await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
      const before = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', limit: 105 })).records)
      await goTo(page, 'userplaylists')
      await page.getByText('Large legacy playlist').click()
      const content = page.locator('.playlistItemsCard')
      const rows = content.locator('[data-playlist-drag-item]')
      await expect(rows).toHaveCount(100)
      await rows.last().scrollIntoViewIfNeeded()
      await expect(rows.last().locator('.h3Title')).toHaveText('Playlist entry 99')
      await rows.last().hover()
      await expect(rows.last().getByTitle('Move Video Down', { exact: true })).toBeVisible()
      await rows.last().getByTitle('Move Video Down', { exact: true }).click()
      await expect.poll(() => page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', offset: 99, limit: 2 })).records.map(record => record.title))).toEqual(['Playlist entry 100', 'Playlist entry 99'])
      await expect(rows.last().locator('.h3Title')).toHaveText('Playlist entry 100')
      await rows.last().locator('.title').click({ button: 'right' })
      const bottom = page.getByRole('menuitem', { name: 'Move Video to the Bottom', exact: true })
      await expect(bottom).toBeVisible()
      await attachScreenshot(`playlist-page-boundary-${layout}`)
      await bottom.click()
      await expect.poll(() => page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', offset: 104, limit: 1 })).records[0].title)).toBe('Playlist entry 100')
      await expect(rows.last().locator('.h3Title')).toHaveText('Playlist entry 99')
      await content.getByRole('button', { name: 'Load More Videos' }).click()
      await expect(rows).toHaveCount(105)
      await rows.last().scrollIntoViewIfNeeded()
      await expect(rows.last().locator('.h3Title')).toHaveText('Playlist entry 100')
      await expect(rows.last().getByTitle('Move Video Down', { exact: true })).toHaveCount(0)
      await expect(rows.first().getByTitle('Move Video Up', { exact: true })).toHaveCount(0)
      await rows.last().locator('.title').click({ button: 'right' })
      await expect(bottom).toHaveCount(0)
      await page.keyboard.press('Escape')
      const after = await page.evaluate(async () => ({
        snapshot: await window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }),
        members: (await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', limit: 105 })).records,
      }))
      const expected = [...before.slice(0, 100), ...before.slice(101), before[100]]
      expect(after.members).toStrictEqual(expected)
      expect(after.snapshot.videos).toStrictEqual([...playlist.videos.slice(0, 100), ...playlist.videos.slice(101, 105), playlist.videos[100]])
      expect(after.snapshot.futureMetadata).toStrictEqual(playlist.futureMetadata)
      expect(after.snapshot.protected).toBe(false)
    })

    test(`reports a rejected ${layout} reorder without changing persisted members`, async ({ page }) => {
      await goTo(page, 'userplaylists')
      await page.getByText('Large legacy playlist').click()
      const rows = page.locator('.playlistItemsCard [data-playlist-drag-item]')
      await expect(rows).toHaveCount(100)
      await rows.last().scrollIntoViewIfNeeded()
      await expect(rows.last().locator('.h3Title')).toHaveText('Playlist entry 99')
      const committed = await page.evaluate(async () => {
        const before = await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', limit: 105 })
        // Simulate another writer changing the revision while this view retains its page.
        await window.ftElectron.libraryQuery('movePlaylistMember', { id: 'large', memberId: before.records[0]._libraryMemberId, direction: 'bottom', revision: before.revision })
        return (await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', limit: 105 })).records
      })
      await rows.last().hover()
      await rows.last().getByTitle('Move Video Down', { exact: true }).click()
      await expect(page.getByText('There was an issue with updating this playlist.', { exact: true })).toBeVisible()
      expect(await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', limit: 105 })).records)).toStrictEqual(committed)
    })
  })
}

for (const zoom of [0.95, 1.25]) {
  test(`keeps Watch playlist paging controls in view after content shrinks at ${zoom} scale`, async ({ page }) => {
    await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    const item = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', offset: 19750, limit: 1 })).records[0])
    await page.evaluate(item => window.ftElectron.tabs.create({ route: `/watch/${item.videoId}?playlistId=large&playlistType=user&playlistItemId=${item.playlistItemId}&libraryMemberId=${item._libraryMemberId}`, makeActive: true }), item)
    const panel = page.locator('.watchVideoPlaylist.resizablePlaylist')
    const scroller = panel.locator('.playlistItemsWrapper')
    const more = scroller.getByRole('button', { name: 'Load More Videos', exact: true })
    const previous = scroller.getByRole('button', { name: 'Load Previous Videos', exact: true })
    const endState = button => button.evaluate(button => {
      const container = button.closest('.playlistItemsWrapper')
      const maximum = Math.max(0, container.scrollHeight - container.clientHeight)
      const scrollbar = container.querySelector('.os-scrollbar-vertical')
      const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
      const handle = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
      const expectedOffset = maximum ? container.scrollTop / maximum * (track.height - handle.height) : 0
      const renderedMaximum = Math.max(0, button.getBoundingClientRect().bottom - container.getBoundingClientRect().top + container.scrollTop + Number.parseFloat(getComputedStyle(button).marginBottom) + Number.parseFloat(getComputedStyle(container).paddingBottom) - container.clientHeight)
      return {
        valid: container.scrollTop <= maximum + 2 / devicePixelRatio,
        noEmptyRange: Math.abs(maximum - renderedMaximum) * devicePixelRatio <= 2,
        atEnd: Math.abs(container.scrollTop - maximum) * devicePixelRatio <= 2,
        buttonInView: (button.getBoundingClientRect().bottom - container.getBoundingClientRect().bottom) * devicePixelRatio <= 2,
        scrollbar: !scrollbar.classList.contains('os-scrollbar-unusable') && Math.abs(handle.top - track.top - expectedOffset) * devicePixelRatio <= 2,
      }
    })
    const expected = { valid: true, noEmptyRange: true, atEnd: true, buttonInView: true, scrollbar: true }
    const scrollToEnd = async button => {
      await expect.poll(async () => {
        await scroller.evaluate(element => { element.scrollTop = Number.MAX_SAFE_INTEGER })
        return endState(button)
      }).toEqual(expected)
    }
    await expect(panel.locator('.playlistItem')).toHaveCount(100)
    await scrollToEnd(more)
    await more.click()
    await expect(panel.locator('.playlistItem').first()).toContainText('Playlist entry 19830')
    await scrollToEnd(more)
    await more.click()
    await expect(panel.locator('.playlistItem')).toHaveCount(70)
    await expect.poll(async () => {
      const { valid, noEmptyRange, scrollbar } = await endState(previous)
      return { valid, noEmptyRange, scrollbar }
    }).toEqual({ valid: true, noEmptyRange: true, scrollbar: true })
    await scrollToEnd(previous)
    await scroller.evaluate(element => { element.style.height = '480px' })
    await expect.poll(() => scroller.evaluate(element => element.clientHeight)).toBe(480)
    await expect.poll(() => endState(previous)).toEqual(expected)
  })
}

async function expectDocumentScrollToMatchContent(page) {
  await expect.poll(() => page.evaluate(() => {
    const content = document.querySelector('.app > .routerView')
    const renderedRange = Math.max(0, content.getBoundingClientRect().bottom + window.scrollY + (Number.parseFloat(getComputedStyle(content).marginBottom) || 0) - window.innerHeight)
    const actualRange = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
    const track = scrollbar?.querySelector('.os-scrollbar-track')?.getBoundingClientRect()
    const handle = scrollbar?.querySelector('.os-scrollbar-handle')?.getBoundingClientRect()
    const expectedOffset = actualRange ? window.scrollY / actualRange * (track.height - handle.height) : 0
    return {
      valid: window.scrollY <= renderedRange + 2 / devicePixelRatio,
      noEmptyRange: Math.abs(actualRange - renderedRange) * devicePixelRatio <= 2,
      scrollbar: actualRange > 1
        ? !scrollbar?.classList.contains('os-scrollbar-unusable') && Math.abs(handle.top - track.top - expectedOffset) * devicePixelRatio <= 2
        : scrollbar?.classList.contains('os-scrollbar-unusable'),
    }
  })).toEqual({ valid: true, noEmptyRange: true, scrollbar: true })
}

test('reconciles synced unseen marks beyond the cached history page in both windows', async ({ app, page }) => {
  const second = await openNewWindowFromTabBar(app, page)
  await waitForAppReady(second)
  const unseenAt = history[1].timeWatched + 1000
  await second.evaluate(async ({ records, action }) => {
    for (const record of records) await window.ftElectron.dbHistory(action, record)
  }, { records: [{ ...history[0], isWatched: true }, { ...history[1], isWatched: true, timeWatched: unseenAt + 1 }], action: DBActions.GENERAL.UPSERT })
  for (const window of [page, second]) {
    await window.evaluate(async ids => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('retainVideoState', ids)
      await store.dispatch('grabHistory')
    }, [history[0].videoId, history[1].videoId])
    expect(await window.evaluate(id => {
      const state = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.history
      return { cached: state.historyCacheSorted.length, offPage: !state.historyCacheSorted.some(record => record.videoId === id), watched: state.historyCacheById[id].isWatched }
    }, history[0].videoId)).toEqual({ cached: 100, offPage: true, watched: true })
  }
  expect(await page.evaluate(async ({ ids, unseenAt }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('mergeSubscriptionSeenVideos', ids.map(videoId => ({ videoId, seenAt: unseenAt, unseenAt })))
    return store.dispatch('applySubscriptionUnseenHistory')
  }, { ids: [history[0].videoId, history[1].videoId], unseenAt })).toBe(1)
  for (const window of [page, second]) {
    await expect.poll(() => window.evaluate(ids => {
      const state = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.history
      return ids.map(id => state.historyCacheById[id]?.isWatched)
    }, [history[0].videoId, history[1].videoId])).toEqual([false, true])
    expect((await residentState(window)).historyRows).toBe(100)
  }
  const records = await page.evaluate(async ids => (await window.ftElectron.libraryQuery('videoState', { ids })).history, [history[0].videoId, history[1].videoId])
  expect(records.find(record => record.videoId === history[0].videoId)).toStrictEqual(history[0])
  expect(records.find(record => record.videoId === history[1].videoId)).toStrictEqual({ ...history[1], isWatched: true, timeWatched: unseenAt + 1 })
})

test.describe('cross-window repairs of duplicate history occurrences', () => {
  const original = [
    { ...history[0], _id: 'new', title: 'Newest occurrence', timeWatched: 20, watchProgress: 90, unknown: { newest: true }, lastViewedPlaylistItemId: 'new-member' },
    { ...history[0], _id: 'old', title: 'Older occurrence', timeWatched: 10, watchProgress: 25, unknown: { older: true }, lastViewedPlaylistItemId: 'old-member' },
  ]
  test.use({ seed: { settings: { historyWatchedStatusMigrated: true, historyRetentionDays: 0 }, history: original, playlists: [], watchStats: [{ _id: 'history-watch-time-v1' }] } })
  test('repair broadcasts retain both occurrences and newest playback state in both windows', async ({ app, page }) => {
    const second = await openNewWindowFromTabBar(app, page)
    await waitForAppReady(second)
    for (const window of [page, second]) {
      await window.evaluate(async videoId => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('retainVideoState', [videoId])
        await store.dispatch('grabHistory')
      }, original[0].videoId)
    }
    let expected = original
    for (const repairedIds of [['old'], ['new'], ['old', 'new']]) {
      const metadata = repairedIds.map(_id => ({ _id, videoId: original[0].videoId, title: `Repaired ${_id}`, lengthSeconds: 120 }))
      await page.evaluate(async metadata => {
        await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateSubscriptionHistory', { metadata })
      }, metadata)
      expected = expected.map(row => repairedIds.includes(row._id) ? { ...row, title: `Repaired ${row._id}`, lengthSeconds: 120 } : row)
      for (const window of [page, second]) {
        await expect.poll(() => window.evaluate(videoId => {
          const state = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.history
          return { records: state.historyCacheSorted, playback: state.historyCacheById[videoId] }
        }, original[0].videoId)).toStrictEqual({ records: expected, playback: expected[0] })
      }
      expect((await page.evaluate(() => window.ftElectron.libraryQuery('historyPage', { limit: 100 }))).records).toStrictEqual(expected)
    }
  })
})

test.describe('Shorts navigation after profile read failures', () => {
  const oldChannel = 'UC-old-shorts'
  const newChannel = 'UC-new-shorts'
  const current = 'jNQXAC9IVRw'
  const entries = (channelId, ids) => ids.map((videoId, index) => ({ videoId, title: `Short ${index + 1}`, authorId: channelId, isShort: true, published: 3 - index }))
  test.use({
    seed: {
      settings: { historyWatchedStatusMigrated: true, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, uiScale: 95, fetchSubscriptionsAutomatically: false },
      history: [],
      playlists: [],
      watchStats: [{ _id: 'history-watch-time-v1' }],
      profiles: [
        { _id: 'allChannels', name: 'All Channels', subscriptions: [{ id: oldChannel, name: 'Old channel' }, { id: newChannel, name: 'New channel' }] },
        { _id: 'old-profile', name: 'Old profile', subscriptions: [{ id: oldChannel, name: 'Old channel' }] },
        { _id: 'new-profile', name: 'New profile', subscriptions: [{ id: newChannel, name: 'New channel' }] },
      ],
      subscriptionCache: [
        { _id: oldChannel, shorts: entries(oldChannel, ['previous123', current, 'nextshort12']) },
        { _id: newChannel, shorts: entries(newChannel, ['newshort001', 'newshort002']) },
      ],
    }
  })
  test('routine progress refresh keeps current-profile Shorts navigation available', async ({ app, page }) => {
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateActiveProfile', 'old-profile'))
    await mockPlayableWatchPage(app, page)
    await routeDemoMedia(page, await readFile(new URL('../../fixtures/media/short-demo.webm', import.meta.url)))
    await page.route('**/youtubei/v1/player**', route => {
      const response = demoPlayerResponse(JSON.parse(route.request().postData()).videoId)
      Object.assign(response.streamingData.formats[0], { width: 360, height: 640 })
      return route.fulfill({ json: response })
    })
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.locator(sel.searchInput).fill(`https://www.youtube.com/shorts/${current}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.locator('.ftVideoPlayer.shortsPlayer')).toBeVisible()
    const watch = await watchViewHandle(page)
    await expect.poll(() => watch.evaluate(view => view.hasNextSubscriptionShort && view.hasPreviousSubscriptionShort)).toBe(true)
    await page.locator('.ftVideoPlayer video').evaluate(video => video.pause())
    await watch.evaluate(view => { globalThis.__testShortsRevisionFeed = view.libraryShortsFeed })
    await app.electronApp.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('library-query')
      globalThis.holdShortsRevisionReads = true
      globalThis.releaseShortsRevisionReads = []
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', (event, request) => {
        if (request.method === 'subscriptionShortsWindow' && globalThis.holdShortsRevisionReads) {
          return new Promise(resolve => {
            globalThis.releaseShortsRevisionReads.push(async () => resolve(await original(event, request)))
          })
        }
        return original(event, request)
      })
    })
    await watch.evaluate(view => view.$store.dispatch('updateHistory', {
      ...view.$store.state.history.historyCacheById[view.videoId], videoId: view.videoId, watchProgress: 12
    }))
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.releaseShortsRevisionReads.length)).toBeGreaterThan(0)
    expect(await watch.evaluate(view => ({ sameFeed: view.libraryShortsFeed === globalThis.__testShortsRevisionFeed, next: view.hasNextSubscriptionShort, previous: view.hasPreviousSubscriptionShort }))).toStrictEqual({ sameFeed: true, next: true, previous: true })
    await app.electronApp.evaluate(async () => {
      globalThis.holdShortsRevisionReads = false
      await Promise.all(globalThis.releaseShortsRevisionReads.map(release => release()))
    })
    await expect.poll(() => watch.evaluate(view => view.libraryShortsFeed !== globalThis.__testShortsRevisionFeed)).toBe(true)
    await watch.evaluate(() => { delete globalThis.__testShortsRevisionFeed })
    await watch.dispose()
  })
  test('a failed new-profile Shorts read disables old targets and Retry loads the current profile', async ({ app, page }, testInfo) => {
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateActiveProfile', 'old-profile'))
    expect((await page.evaluate(channelId => window.ftElectron.libraryQuery('subscriptionEntries', { channelId, field: 'shorts', ids: ['newshort001', 'newshort002'] }), newChannel)).map(video => video.videoId)).toStrictEqual(['newshort001', 'newshort002'])
    await mockPlayableWatchPage(app, page)
    await routeDemoMedia(page, await readFile(new URL('../../fixtures/media/short-demo.webm', import.meta.url)))
    await page.route('**/youtubei/v1/player**', route => {
      const response = demoPlayerResponse(JSON.parse(route.request().postData()).videoId)
      Object.assign(response.streamingData.formats[0], { width: 360, height: 640 })
      return route.fulfill({ json: response })
    })
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.locator(sel.searchInput).fill(`https://www.youtube.com/shorts/${current}`)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.locator('.ftVideoPlayer.shortsPlayer')).toBeVisible()
    const watch = await watchViewHandle(page)
    await expect.poll(() => watch.evaluate(view => view.hasNextSubscriptionShort)).toBe(true)
    await page.locator('.ftVideoPlayer video').evaluate(video => video.pause())
    await app.electronApp.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('library-query')
      globalThis.failShortsProfileRead = true
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', (event, request) => {
        if (request.method === 'subscriptionShortsWindow' && globalThis.failShortsProfileRead) throw new Error('simulated new-profile Shorts read failure')
        return original(event, request)
      })
    })
    await watch.evaluate(view => view.$store.dispatch('updateActiveProfile', 'new-profile'))
    const retry = page.getByRole('button', { name: 'Retry', exact: true })
    await expect(retry).toBeVisible()
    expect(await watch.evaluate(view => ({ feed: view.libraryShortsFeed, next: view.hasNextSubscriptionShort, previous: view.hasPreviousSubscriptionShort }))).toStrictEqual({ feed: [], next: false, previous: false })
    await watch.evaluate(view => view.navigateSubscriptionShort(1))
    await expect(page).toHaveURL(new RegExp(`/watch/${current}`))
    await page.screenshot({ path: testInfo.outputPath('shorts-profile-read-retry-95.png'), animations: 'disabled' })
    await app.electronApp.evaluate(() => { globalThis.failShortsProfileRead = false })
    await retry.click()
    await expect.poll(() => watch.evaluate(view => view.libraryShortsFeed.map(video => video.videoId))).toStrictEqual(['newshort001', 'newshort002'])
    await expect(retry).toHaveCount(0)
    await watch.dispose()
  })
})

test('migrates immutable originals, hydrates bounded views, and preserves concurrent writes during legacy imports', async ({ app, page }) => {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await goTo(page, 'history')
  await expect(page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')).toHaveCount(100)
  expect(await residentState(page)).toEqual({ paged: true, total: 350, historyRows: 100, playlistRows: 0, largeCount: 20000 })
  expect(await page.evaluate(() => {
    const settings = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings
    return { locale: settings.currentLocale, arguments: settings.externalPlayerCustomArgs }
  })).toEqual({ locale: 'en-US', arguments: '["--play","--quit"]' })
  for (const [filename, records] of [['history', history], ['playlists', [playlist]]]) {
    expect(await readFile(path.join(app.userDataDir, `${filename}.db`), 'utf8')).toBe(records.map(record => JSON.stringify(record)).join('\n') + '\n')
  }

  const second = await openNewWindowFromTabBar(app, page)
  await waitForAppReady(second)
  await goTo(second, 'history')
  expect((await residentState(second)).playlistRows).toBe(0)

  const job = await page.evaluate(async () => {
    const job = await window.ftElectron.libraryQuery('importStart', { format: 'records' })
    await window.ftElectron.libraryQuery('importChunk', {
      ...job,
      section: 'history',
      records: [{
        videoId: 'v0000000000', timeWatched: 1, watchProgress: 1, isWatched: false, importedUnknown: 'keep',
      }]
    })
    await window.ftElectron.libraryQuery('importChunk', {
      ...job,
      section: 'playlists',
      records: [{
        _id: 'large',
        playlistName: 'Large legacy playlist',
        protected: false,
        videos: [{ videoId: 'newimport01', playlistItemId: 'duplicate-legacy-id', title: 'Imported entry' }],
      }]
    })
    await window.ftElectron.libraryQuery('importFinish', job)
    return job
  })
  expect(await second.evaluate(async job => {
    try { await window.ftElectron.libraryQuery('importApply', { ...job, sections: ['history'] }); return 'unexpected' } catch (error) { return error.message }
  }, job)).toMatch(/window|owner|another/i)

  const concurrentHistory = { ...history[0], timeWatched: Date.now(), watchProgress: 120 }
  const concurrentPlaylist = await second.evaluate(async ({ action, record }) => {
    await window.ftElectron.dbHistory(action, record)
    await window.ftElectron.libraryQuery('addSelectedPlaylistVideos', {
      ids: ['large'], videos: [{ videoId: 'concurrent1', title: 'Concurrent entry' }], allowDuplicates: true,
    })
    return window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' })
  }, { action: DBActions.GENERAL.UPSERT, record: concurrentHistory })
  const expectedHistory = concurrentHistory
  await page.evaluate(async job => {
    await window.ftElectron.libraryQuery('importApply', { ...job, sections: ['history', 'playlists'] })
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await Promise.all([store.dispatch('grabHistory'), store.dispatch('grabAllPlaylists')])
  }, job)

  for (const window of [page, second]) {
    await expect.poll(async () => (await residentState(window)).largeCount).toBe(20002)
    const [record] = await window.evaluate(async () => (await window.ftElectron.libraryQuery('videoState', { ids: ['v0000000000'] })).history)
    expect(record).toStrictEqual(expectedHistory)
  }
  const persistedHistory = (await readPersistedDatastore(path.join(app.userDataDir, 'history.db'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(persistedHistory).toHaveLength(history.length + 1)
  const importedHistory = persistedHistory.filter(record => record.importedUnknown === 'keep')
  expect(importedHistory).toStrictEqual([{ _id: expect.any(String), videoId: 'v0000000000', timeWatched: 1, watchProgress: 1, isWatched: false, importedUnknown: 'keep' }])
  const saved = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))
  const concurrentEntry = concurrentPlaylist.videos.at(-1)
  expect(concurrentEntry).toStrictEqual({
    videoId: 'concurrent1',
    title: 'Concurrent entry',
    type: 'video',
    playlistItemId: expect.any(String),
    timeAdded: expect.any(Number),
  })
  expect(saved.lastUpdatedAt).toBeGreaterThanOrEqual(concurrentPlaylist.lastUpdatedAt)
  expect(saved).toStrictEqual({
    ...playlist,
    lastUpdatedAt: saved.lastUpdatedAt,
    videos: [...playlist.videos, concurrentEntry, { videoId: 'newimport01', playlistItemId: 'duplicate-legacy-id', title: 'Imported entry' }],
  })

  await page.getByRole('searchbox', { name: 'Search in History' }).fill('Library video 0')
  await expect(page.locator('.historySearchLoader')).toHaveCount(0)
  await expect.poll(() => page.locator('.tabContent[aria-hidden="false"] .videoThumbnail img').evaluateAll(images => {
    const visible = images.filter(image => image.getBoundingClientRect().top < window.innerHeight)
    return visible.length > 0 && visible.every(image => image.complete && image.naturalWidth > 0)
  })).toBe(true)
  const reopened = await app.relaunch()
  await waitForAppReady(reopened.page)
  expect((await reopened.page.evaluate(async () => (await window.ftElectron.libraryQuery('videoState', { ids: ['v0000000000'] })).history))[0]).toStrictEqual(expectedHistory)
  expect(await reopened.page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))).toStrictEqual(saved)
  for (const [filename, records] of [['history', history], ['playlists', [playlist]]]) {
    expect(await readFile(path.join(app.userDataDir, `${filename}.db`), 'utf8')).toBe(records.map(record => JSON.stringify(record)).join('\n') + '\n')
  }
})

test.describe('playlist summary metadata', () => {
  test.use({ seed: { settings: { historyWatchedStatusMigrated: true, uiScale: 95, currentLocale: 'en_US' }, history, playlists: [playlist, { _id: 'empty', playlistName: 'Empty playlist', videos: [] }], watchStats: [{ _id: 'history-watch-time-v1' }] } })
  test('Save lookup failure offers Retry and preserves exact library records at 95% scale', async ({ app, page }, testInfo) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    const original = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))
    await app.electronApp.evaluate(({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('library-query')
      let fail = true
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', (event, request) => {
        if (request.method === 'playlistSelection' && fail) { fail = false; throw new Error('simulated Save lookup failure') }
        return handler(event, request)
      })
    })
    await page.evaluate(async video => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('showAddToPlaylistPromptForManyVideos', { videos: [video] })
    }, history[0])
    const prompt = page.getByRole('dialog')
    await expect(prompt.getByRole('alert')).toBeVisible()
    await expect(prompt.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    for (const theme of ['dark', 'light']) {
      await page.evaluate(async theme => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateBaseTheme', theme)
      }, theme)
      const screenshot = testInfo.outputPath(`save-lookup-retry-95-${theme}.png`)
      await prompt.screenshot({ path: screenshot })
      await testInfo.attach(`Save Retry at 95% ${theme}`, { path: screenshot, contentType: 'image/png' })
    }
    await prompt.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(prompt.getByRole('alert')).toHaveCount(0)
    await expect(prompt.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    const selector = prompt.locator('.ft-playlist-selector').filter({ hasText: 'Large legacy playlist' })
    await expect(selector.locator('.videoPresenceCount')).toContainText('58')
    await prompt.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))).toStrictEqual(original)
    expect((await page.evaluate(() => window.ftElectron.libraryQuery('historyPage', { limit: 250 }))).records).toStrictEqual(history.toReversed().slice(0, 250))
  })
  test('playlist overview and add prompt use off-page metadata, summary artwork and duplicate counts', async ({ page }) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await goTo(page, 'userplaylists')
    await page.getByText('Playlists with Matching Videos', { exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Playlists with Matching Videos' })).toBeChecked()
    await page.locator('.tabContent[aria-hidden="false"] .searchInputsRow input').fill('Playlist entry 19999')
    await expect(page.locator('.tabContent[aria-hidden="false"] .playlistList .ft-list-item')).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Large legacy playlist', exact: true })).toBeVisible()
    await page.evaluate(async video => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('showAddToPlaylistPromptForManyVideos', { videos: [video] })
    }, history[0])
    const selector = page.getByRole('dialog').locator('.ft-playlist-selector').filter({ hasText: 'Large legacy playlist' })
    await expect(selector.locator('.videoCountContainer .inner > div').first()).toHaveText('20000')
    await expect(selector.locator('.videoPresenceCount')).toContainText('58')
    await expect.poll(() => selector.locator('.thumbnailImage').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  })
  test('batch playlist Save schedules sync after committing and preserves all retained library data', async ({ page }) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.evaluate(async video => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.playlistEditSyncReasons = []
      store.subscribeAction(action => {
        if (action.type === 'scheduleSyncServer') window.playlistEditSyncReasons.push(action.payload)
      })
      await store.dispatch('showAddToPlaylistPromptForManyVideos', { videos: [video] })
    }, history[0])
    const prompt = page.getByRole('dialog')
    await prompt.locator('.ft-playlist-selector').filter({ hasText: 'Empty playlist' }).click()
    await prompt.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(prompt).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.playlistEditSyncReasons)).toStrictEqual(['playlists'])
    const saved = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'empty' }))
    expect(saved.videos).toHaveLength(1)
    const { playlistItemId, timeAdded, ...record } = saved.videos[0]
    expect(typeof playlistItemId).toBe('string')
    expect(playlistItemId.length).toBeGreaterThan(0)
    expect(Number.isSafeInteger(timeAdded)).toBe(true)
    expect(record).toStrictEqual(history[0])
    expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))).toStrictEqual(playlist)
    expect((await page.evaluate(() => window.ftElectron.libraryQuery('historyPage', { limit: 250 }))).records).toStrictEqual(history.toReversed().slice(0, 250))
  })
})

test.describe('age-based history cleanup with restored duplicates', () => {
  const retained = { ...history[0], _id: 'recent-copy', title: 'Recent restored history', timeWatched: Date.now(), unknownLegacyField: { keep: true } }
  test.use({ seed: { settings: { historyWatchedStatusMigrated: true, historyRetentionDays: 0 }, history: [history[0], retained] } })
  test('retains a recent occurrence and refreshes the shelf after deleting the older copy', async ({ page }) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await goTo(page, 'history')
    await expect(page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')).toHaveCount(2)
    const cards = page.locator('.tabContent[aria-hidden="false"] [data-feed-item-key]')
    const keys = await cards.evaluateAll(elements => elements.map(element => element.getAttribute('data-feed-item-key')))
    expect(new Set(keys).size).toBe(2)
    const recentKey = await cards.filter({ hasText: retained.title }).getAttribute('data-feed-item-key')
    await page.getByRole('button', { name: 'Delete Old History', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')).toHaveCount(1)
    await expect(cards).toHaveAttribute('data-feed-item-key', recentKey)
    await expect(cards).toContainText(retained.title)
    const result = await page.evaluate(() => window.ftElectron.libraryQuery('historyPage'))
    expect(result.records).toStrictEqual([retained])
    expect(result.total).toBe(1)
    expect(result.cursor).toBeNull()
    await expect.poll(() => page.evaluate(() => {
      const state = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.history
      return { total: state.historyTotal, sorted: state.historyCacheSorted.map(record => record._id), cached: Object.values(state.historyCacheById).map(record => record._id) }
    })).toEqual({ total: 1, sorted: ['recent-copy'], cached: ['recent-copy'] })
  })
})

for (const scale of [95, 125]) {
  test(`clamps loaded History pages after responsive reflow at ${scale}% scale`, async ({ app, page }) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.evaluate(async scale => {
      await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', scale)
    }, scale)
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
    await goTo(page, 'history')
    const content = page.locator('.tabContent[aria-hidden="false"] .historySearch').locator('xpath=..')
    const cards = content.locator('.autoGrid > *')
    await expect(cards).toHaveCount(100)
    for (const count of [200, 300]) {
      await content.getByRole('button', { name: 'Load More Videos' }).click()
      await expect(cards).toHaveCount(count)
    }
    await expect.poll(() => page.evaluate(() => {
      document.activeElement?.blur()
      window.scrollTo(0, Number.MAX_SAFE_INTEGER)
      return window.scrollY
    })).toBeGreaterThan(500)
    const before = await content.evaluate(element => element.getBoundingClientRect().height)
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 1100))
    await expect.poll(() => content.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(before)
    await expectDocumentScrollToMatchContent(page)
  })
}

for (const layout of ['grid', 'list']) {
  test.describe(`paged playlist ${layout} scroll range`, () => {
    test.use({
      seed: {
        settings: { uiScale: 95, playlistViewType: layout, userPlaylistSortOrder: 'custom', generalAutoLoadMorePaginatedItemsEnabled: false, alwaysShowScrollbars: true },
        playlists: [{ ...playlist, protected: false, videos: playlist.videos.slice(0, 350) }],
      }
    })
    test('keeps loaded pages and the scroll position after a same-playlist move at fractional scale', async ({ page }) => {
      await goTo(page, 'userplaylists')
      await page.getByRole('link', { name: 'Large legacy playlist', exact: true }).click()
      const content = page.locator('.tabContent[aria-hidden="false"] .playlistPage')
      const cards = content.locator('.autoGrid > *, .playlistItems > .playlistItem')
      for (const count of [100, 200, 300]) {
        if (count > 100) await content.getByRole('button', { name: 'Load More Videos' }).click()
        await expect(cards).toHaveCount(count)
      }
      await expect.poll(() => page.evaluate(() => {
        document.activeElement?.blur()
        window.scrollTo(0, Number.MAX_SAFE_INTEGER)
        return window.scrollY
      })).toBeGreaterThan(500)
      const offset = await page.evaluate(() => window.scrollY)
      const before = await page.evaluate(async () => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))
      await page.evaluate(async () => {
        const member = await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', offset: 250, limit: 1 })
        await window.ftElectron.libraryQuery('movePlaylistMember', { id: 'large', memberId: member.records[0]._libraryMemberId, direction: 1, revision: member.revision })
        await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('grabAllPlaylists')
      })
      await expect(cards).toHaveCount(300)
      await expect(cards.nth(250)).toHaveAttribute('data-video-id', 'v0000000251')
      await expect(cards).toHaveCount(300)
      await expectDocumentScrollToMatchContent(page)
      await expect.poll(() => page.evaluate(previous => Math.abs(window.scrollY - previous) * devicePixelRatio, offset)).toBeLessThanOrEqual(2)
      const after = await page.evaluate(async () => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))
      const expected = before.videos.slice()
      expected.splice(250, 2, before.videos[251], before.videos[250])
      expect(after).toStrictEqual({ ...before, lastUpdatedAt: after.lastUpdatedAt, videos: expected })
    })
    for (const trigger of ['search', 'no-match search', 'sort', 'locale', 'removal', 'resize', 'layout']) {
      test(`clamps loaded pages after ${trigger} at fractional scale`, async ({ app, page }) => {
        await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
        await goTo(page, 'userplaylists')
        await page.getByRole('link', { name: 'Large legacy playlist', exact: true }).click()
        const content = page.locator('.tabContent[aria-hidden="false"] .playlistPage')
        const cards = content.locator('.autoGrid > *, .playlistItems > .playlistItem')
        await expect(cards).toHaveCount(100)
        for (const count of [200, 300]) {
          await content.getByRole('button', { name: 'Load More Videos' }).click()
          await expect(cards).toHaveCount(count)
        }
        await expect.poll(() => page.evaluate(() => {
          document.activeElement?.blur()
          window.scrollTo(0, Number.MAX_SAFE_INTEGER)
          return window.scrollY
        })).toBeGreaterThan(500)
        if (trigger.includes('search')) {
          await updateInputWithoutScrolling(content.locator('.searchInputsRow input'), trigger === 'search' ? 'Playlist entry 349' : 'no matching fixture')
          await expect(cards).toHaveCount(trigger === 'search' ? 1 : 0)
        } else if (trigger === 'resize') {
          await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 1100))
        } else if (trigger === 'removal') {
          await page.evaluate(async () => {
            const members = []
            for (const offset of [5, 255]) members.push(...(await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', offset, limit: 250 })).records)
            await window.ftElectron.libraryQuery('removePlaylistMembers', { id: 'large', memberIds: members.map(video => video._libraryMemberId) })
            await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('grabAllPlaylists')
          })
          await expect(cards).toHaveCount(5)
        } else {
          await page.evaluate(async ({ trigger, layout }) => {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
            const actions = { sort: ['updateUserPlaylistSortOrder', 'video_title_ascending'], locale: ['updateCurrentLocale', 'de-DE'], layout: ['updatePlaylistViewType', layout === 'list' ? 'grid' : 'list'] }
            await store.dispatch(...actions[trigger])
          }, { trigger, layout })
          if (trigger !== 'layout') await expect(cards).toHaveCount(100)
        }
        await expectDocumentScrollToMatchContent(page)
      })
    }
  })
}

test.describe('all Continue Watching candidates remain reachable', () => {
  const continued = history.slice(0, 61)
  test.use({ seed: { settings: { historyWatchedStatusMigrated: true, uiScale: 95, currentLocale: 'en_US', animationSpeed: 1000 }, history: continued, playlists: [], watchStats: [{ _id: 'history-watch-time-v1' }] } })
  test('loads past the first fifty, recovers from a failed page and retains exact durable history', async ({ app, page }, testInfo) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await app.electronApp.evaluate(({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('library-query')
      let fail = true
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', (event, request) => {
        if (request.method === 'continuedHistoryPage' && fail) { fail = false; throw new Error('simulated Continue Watching page failure') }
        return handler(event, request)
      })
    })
    await goTo(page, 'home')
    const section = page.locator('[data-home-section="continueWatching"]')
    const shelf = section.locator('[data-home-shelf]')
    const next = section.getByRole('button', { name: 'Next Continue watching page', exact: true })
    const activePage = shelf.locator('.shelfPage:not([aria-hidden="true"])')
    const loaded = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.history.continuedHistory.length)
    await expect.poll(loaded).toBe(50)
    await expect(next).toBeEnabled()
    let failureObserved = false
    for (let count = 0; count < 70; count++) {
      const previousIndex = Number(await activePage.getAttribute('data-home-shelf-page'))
      const pageSize = await activePage.evaluate(element => Number(element.style.getPropertyValue('--home-shelf-columns')))
      if (previousIndex === Math.ceil(61 / pageSize)) break
      await next.click()
      if (!failureObserved && (previousIndex + 1) * pageSize > 50) {
        failureObserved = true
        await expect(activePage).toHaveAttribute('data-home-shelf-page', String(previousIndex))
        expect(await loaded()).toBe(50)
        await expect(activePage.locator('.mediaDetails strong')).not.toHaveCount(0)
      } else {
        await expect(activePage).toHaveAttribute('data-home-shelf-page', String(previousIndex + 1))
      }
      await expect(shelf).toHaveAttribute('aria-busy', 'false')
    }
    expect(failureObserved).toBe(true)
    await expect(next).toBeDisabled()
    await expect(activePage).toContainText('Library video 0')
    expect(await loaded()).toBe(61)
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 900))
    await expect(activePage.locator('.mediaDetails strong')).not.toHaveCount(0)
    await expectDocumentScrollToMatchContent(page)
    expect((await page.evaluate(() => window.ftElectron.libraryQuery('historyPage', { limit: 100 }))).records).toStrictEqual(continued.toReversed())
    await page.evaluate(async () => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', 100))
    const screenshot = testInfo.outputPath('continue-watching-older-page.png')
    await section.screenshot({ path: screenshot })
    await testInfo.attach('continue-watching-older-page', { path: screenshot, contentType: 'image/png' })
  })
})

test.describe('retained opaque playlist preview', () => {
  const opaquePlaylist = {
    _id: 'home-opaque-first',
    playlistName: 'Retained opaque first',
    createdAt: 1,
    lastUpdatedAt: 1,
    videos: [null, { videoId: 'jNQXAC9IVRw', title: 'Retained valid member', unknown: { keep: true } }],
    unknown: { retained: true },
  }
  const opaqueMembership = { _id: 'opaque-membership', playlistName: 'Retained opaque membership', videos: null, unknown: { retained: true } }
  test.use({ seed: { settings: { landingPage: 'home', enableHomeRecommendations: false, fetchSubscriptionsAutomatically: false, historyWatchedStatusMigrated: true, quickBookmarkTargetPlaylistId: opaqueMembership._id, uiScale: 95, baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light' }, history: [history[0]], playlists: [opaquePlaylist, opaqueMembership] } })
  test('Home renders a placeholder for an opaque first playlist member without changing the library', async ({ page }, testInfo) => {
    await goTo(page, 'home')
    const card = page.getByRole('link', { name: /Retained opaque first/ })
    await expect(card).toBeVisible({ timeout: 5000 })
    await expect(card.locator('img')).toHaveAttribute('src', /thumbnail_placeholder|data:image\/svg/)
    await card.scrollIntoViewIfNeeded()
    await expectImagesLoaded(card.locator('img'))
    expect(await page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getAllPlaylists.find(playlist => playlist._id === id)?.videoCount, opaquePlaylist._id)).toBe(2)
    const saved = await page.evaluate(id => window.ftElectron.libraryQuery('playlistSnapshot', { id }), opaquePlaylist._id)
    expect(saved).toStrictEqual(opaquePlaylist)
    expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPlaylistsReady)).toBe(true)
    expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getQuickBookmarkTargetPlaylistId)).toBe(opaquePlaylist._id)
    expect(await page.evaluate(id => window.ftElectron.libraryQuery('playlistSnapshot', { id }), opaqueMembership._id)).toStrictEqual(opaqueMembership)
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(scheme))
      const capture = testInfo.outputPath(`opaque-playlist-home-${scheme}.png`)
      const bounds = await card.boundingBox()
      expect(bounds, 'visible Home playlist card must have capture bounds').not.toBeNull()
      await page.screenshot({ path: capture, clip: { ...bounds, width: Math.min(bounds.width, 420) } })
      await testInfo.attach(`Opaque playlist Home ${scheme}`, { path: capture, contentType: 'image/png' })
    }
  })
  test('Save renders an unnamed opaque playlist at 95% scale without changing retained data', async ({ page }, testInfo) => {
    const retained = { ...opaquePlaylist, playlistName: null }
    await page.evaluate(async ({ playlist, action }) => {
      await window.ftElectron.dbPlaylists(action, playlist)
      await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('grabAllPlaylists')
    }, { playlist: retained, action: DBActions.GENERAL.UPSERT })
    await goTo(page, 'history')
    const card = page.locator('.tabContent[aria-hidden="false"] .ft-list-video').first()
    await card.hover()
    await card.locator('.addToPlaylistIcon .iconButton').click()
    const picker = card.locator('.addToPlaylistDropdown')
    await expect(picker.getByRole('option').filter({ hasText: 'Retained opaque membership' })).toHaveCount(0)
    const row = picker.getByRole('option').filter({ has: page.locator('.playlistName', { hasText: /^Playlists$/ }) })
    await picker.locator('.playlistSearch input').fill('Playlists')
    await expect(row).toBeVisible()
    await expect(row.locator('.videoCount')).toHaveText('2 videos')
    await expect(row.locator('img')).toHaveAttribute('src', /thumbnail_placeholder|data:image\/svg/)
    await expectImagesLoaded(row.locator('img'))
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme })
      await expect(page.locator('body')).toHaveClass(new RegExp(scheme))
      await row.hover()
      await expect(card.locator('.addToPlaylistIcon')).toHaveCSS('opacity', '1')
      const capture = testInfo.outputPath(`opaque-playlist-save-${scheme}.png`)
      const bounds = await picker.boundingBox()
      expect(bounds, 'visible Save picker must have capture bounds').not.toBeNull()
      await page.screenshot({ path: capture, clip: { x: bounds.x - 12, y: bounds.y - 16, width: bounds.width + 24, height: bounds.height + 32 } })
      await testInfo.attach(`Opaque playlist Save ${scheme}`, { path: capture, contentType: 'image/png' })
    }
    expect(await page.evaluate(id => window.ftElectron.libraryQuery('playlistSnapshot', { id }), retained._id)).toStrictEqual(retained)
    expect(await page.evaluate(id => window.ftElectron.libraryQuery('playlistSnapshot', { id }), opaqueMembership._id)).toStrictEqual(opaqueMembership)
    expect((await page.evaluate(() => window.ftElectron.libraryQuery('historyPage', { limit: 10 }))).records).toStrictEqual([history[0]])
  })
})

test.describe('saved to remote playlist ownership', () => {
  test.use({ seed: { settings: { historyWatchedStatusMigrated: true, uiScale: 95, backendPreference: 'invidious', backendFallback: false, defaultInvidiousInstance: 'https://invidious.test', autoplayVideos: false, autoplayPlaylists: false, skipUnavailablePlaylistVideos: false }, history, playlists: [playlist] } })
  test('a delayed saved window cannot replace remote playlist rows or skip targets', async ({ app, page }) => {
    const remote = [{ ...history[190], title: 'Remote current' }, { ...history[191], title: 'Remote next' }]
    await page.route(/^https?:\/\//, route => route.request().url().startsWith('https://invidious.test/api/v1/playlists/remote-list')
      ? route.fulfill({ json: { title: 'Remote playlist', author: 'Remote author', authorId: 'channel', videoCount: remote.length, videos: remote } })
      : route.fulfill({ status: 404, body: '' }))
    const item = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', offset: 190, limit: 1 })).records[0])
    await app.electronApp.evaluate(({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('library-query')
      globalThis.savedWindowHandler = handler
      globalThis.pendingSavedWindows = []
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', async (event, request) => {
        const result = await handler(event, request)
        if (request.method === 'playlistWindow' && request.data.id === 'large') {
          await new Promise(resolve => globalThis.pendingSavedWindows.push(resolve))
        }
        return result
      })
    })
    await page.evaluate(item => window.ftElectron.tabs.create({ route: `/watch/${item.videoId}?playlistId=large&playlistType=user&libraryMemberId=${item._libraryMemberId}`, makeActive: true }), item)
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.pendingSavedWindows.length)).toBeGreaterThan(0)
    const view = await watchViewHandle(page)
    await view.evaluate((watch, id) => watch.tabRouter.push({ path: `/watch/${id}`, query: { playlistId: 'remote-list', playlistType: 'invidious' } }), item.videoId)
    const rows = page.locator('.watchVideoPlaylist.resizablePlaylist .playlistItem')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Remote current')
    await expect(rows.last()).toContainText('Remote next')
    await app.electronApp.evaluate(({ ipcMain }) => {
      for (const resolve of globalThis.pendingSavedWindows) resolve()
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', globalThis.savedWindowHandler)
      delete globalThis.pendingSavedWindows
      delete globalThis.savedWindowHandler
    })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Remote current')
    await expect.poll(() => view.evaluate(watch => watch.$refs.watchVideoPlaylist.nextVideo?.videoId)).toBe(remote[1].videoId)
    expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))).toStrictEqual(playlist)
  })
})

test.describe('Watch moves across retained hidden members', () => {
  const a = { ...history[0], playlistItemId: 'first' }
  const b = { ...history[1], playlistItemId: 'second' }
  const hidden = [null, false, { postId: 'post', unknown: { keep: true } }, { videoId: 42 }, { videoId: '' }]
  const playlist = { _id: 'hidden-move', playlistName: 'Retained hidden members', createdAt: 1, lastUpdatedAt: 1, protected: false, videos: [a, ...hidden, b], future: { keep: true } }
  test.use({ seed: { settings: { historyWatchedStatusMigrated: true, uiScale: 95, userPlaylistSortOrder: 'custom', fetchSubscriptionsAutomatically: false }, history: [], playlists: [playlist] } })
  test('one downward move changes the visible Watch order while preserving hidden members', async ({ app, page, attachScreenshot }) => {
    await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
    const item = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistWindow', { id: 'hidden-move', playableOnly: true, limit: 1 })).records[0])
    await page.evaluate(item => window.ftElectron.tabs.create({ route: `/watch/${item.videoId}?playlistId=hidden-move&playlistType=user&playlistItemId=${item.playlistItemId}&libraryMemberId=${item._libraryMemberId}`, makeActive: true }), item)
    const panel = page.locator('.watchVideoPlaylist.resizablePlaylist')
    const rows = panel.locator('.playlistItem')
    await expect(rows).toHaveCount(2)
    await expect(rows.first().getByText(a.title, { exact: true })).toBeVisible()
    const before = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'hidden-move' }))
    await app.electronApp.evaluate(({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('library-query')
      globalThis.watchMoveGate = Promise.withResolvers()
      globalThis.watchMovePending = false
      ipcMain.removeHandler('library-query')
      ipcMain.handle('library-query', async (event, request) => {
        if (request.method === 'movePlaylistMember') {
          globalThis.watchMovePending = true
          await globalThis.watchMoveGate.promise
        }
        return handler(event, request)
      })
    })
    await rows.first().hover()
    await rows.first().locator('.downArrowIcon').click()
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.watchMovePending)).toBe(true)
    await expect(panel.locator('.downArrowIcon, .upArrowIcon')).toHaveCount(0)
    await expect(panel.locator('.playlistItem[draggable="true"]')).toHaveCount(0)
    await attachScreenshot('watch-reorder-controls-disabled-95')
    await app.electronApp.evaluate(() => globalThis.watchMoveGate.resolve())
    await expect(rows.first().getByText(b.title, { exact: true })).toBeVisible()
    await expect(rows.last().getByText(a.title, { exact: true })).toBeVisible()
    await expect(panel.locator('.downArrowIcon')).toHaveCount(1)
    await expect(panel.locator('.playlistItem[draggable="true"]')).toHaveCount(2)
    const after = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'hidden-move' }))
    expect(after).toStrictEqual({ ...before, videos: [b, ...hidden, a], lastUpdatedAt: after.lastUpdatedAt })
  })
})

test.describe('deleted first playing member', () => {
  const retained = { ...playlist, _id: 'first-deletion', videos: playlist.videos.slice(0, 3) }
  test.use({ seed: { settings: { historyWatchedStatusMigrated: true, uiScale: 95, autoplayVideos: false, autoplayPlaylists: false, skipUnavailablePlaylistVideos: false, userPlaylistSortOrder: 'custom' }, history, playlists: [retained] } })
  test('deleting the first playing member continues to the first survivor without wrapping', async ({ page }) => {
    await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
    const first = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistWindow', { id: 'first-deletion', offset: 0, limit: 1 })).records[0])
    await page.evaluate(item => window.ftElectron.tabs.create({ route: `/watch/${item.videoId}?playlistId=first-deletion&playlistType=user&libraryMemberId=${encodeURIComponent(item._libraryMemberId)}`, makeActive: true }), first)
    const playerPlaylist = page.locator('.watchVideoPlaylist.resizablePlaylist')
    await expect(playerPlaylist.locator('.playlistIndex label')).toHaveText('1 / 3')
    const view = await watchViewHandle(page)
    await page.evaluate(item => window.ftElectron.libraryQuery('removePlaylistMembers', { id: 'first-deletion', memberIds: [item._libraryMemberId] }), first)
    await expect.poll(() => view.evaluate(watch => ({ next: watch.$refs.watchVideoPlaylist.nextVideo?.videoId, enabled: watch.canSkipToNextVideo }))).toStrictEqual({ next: retained.videos[1].videoId, enabled: true })
    await view.evaluate(watch => watch.handleSkipToNext())
    await expect(playerPlaylist.locator('.playlistIndex label')).toHaveText('1 / 2')
    const saved = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'first-deletion' }))
    expect(saved.videos).toStrictEqual(retained.videos.slice(1))
  })
})

test.describe('Watch playlist metadata repair', () => {
  const members = ['jNQXAC9IVRw', 'abcdefghijk', 'bcdefghijkl'].map((videoId, index) => ({
    videoId,
    playlistItemId: `repair-${index}`,
    title: `Repair member ${index}`,
    author: 'Channel',
    authorId: 'channel',
    published: 1,
    lengthSeconds: [50, 0, 100][index],
    isLive: false,
    isUpcoming: false,
    unknown: { retained: index },
  }))
  const retained = { _id: 'repair-order', playlistName: 'Repair order', protected: false, createdAt: 1, lastUpdatedAt: 1, videos: members }
  test.use({ seed: { settings: { historyWatchedStatusMigrated: true, historyRetentionDays: 0, userPlaylistSortOrder: 'video_duration_ascending', uiScale: 95, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true }, history: [], playlists: [retained], watchStats: [{ _id: 'history-watch-time-v1' }] } })
  test('refreshes Watch neighbors after a same-size same-timestamp duration repair', async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    const first = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistPage', { id: 'repair-order' })).records[0])
    await page.evaluate(item => window.ftElectron.tabs.create({ route: `/watch/${item.videoId}?playlistId=repair-order&playlistType=user&libraryMemberId=${item._libraryMemberId}`, makeActive: true }), first)
    await expect(page.locator('.watchVideoPlaylist.resizablePlaylist')).toBeVisible()
    const view = await watchViewHandle(page)
    await expect.poll(() => view.evaluate(watch => watch.$refs.watchVideoPlaylist.nextVideo?.videoId)).toBe(members[2].videoId)
    const before = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'repair-order' }))
    expect(Number.isFinite(before.lastPlayedAt)).toBe(true)
    expect(before).toStrictEqual({ ...retained, lastPlayedAt: before.lastPlayedAt })
    await page.evaluate(async videoId => {
      await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('repairPlaylistMetadata', {
        playlistIds: ['repair-order'], metadata: [{ videoId, lengthSeconds: 75, isLive: false, isUpcoming: false }],
      })
    }, members[1].videoId)
    await expect.poll(() => view.evaluate(watch => watch.$refs.watchVideoPlaylist.nextVideo?.videoId)).toBe(members[1].videoId)
    expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'repair-order' }))).toStrictEqual({
      ...before, videos: members.map((member, index) => index === 1 ? { ...member, lengthSeconds: 75 } : member),
    })
    await page.locator('.watchVideoPlaylist.resizablePlaylist').screenshot({ path: testInfo.outputPath('watch-neighbors-after-duration-repair-95.png') })
  })
})

test.describe('retained full-record playlist counts', () => {
  const saved = { _id: 'counted', playlistName: 'Retained counted playlist', protected: false, createdAt: 1, lastUpdatedAt: 1, videoCount: 0, firstVideo: { videoId: 'abcdefghijk', unknown: { retained: true } }, videos: [{ videoId: history[0].videoId, playlistItemId: 'first' }, { videoId: history[0].videoId, playlistItemId: 'duplicate' }], unknown: { retained: true } }
  const empty = { _id: 'z-counted-empty', playlistName: 'Actually empty', protected: false, createdAt: 1, lastUpdatedAt: 1, videoCount: 42, videos: [], unknown: { retained: true } }
  test.use({ seed: { settings: { historyWatchedStatusMigrated: true, historyRetentionDays: 0, currentLocale: 'en_US', uiScale: 95, quickBookmarkTargetPlaylistId: 'missing' }, history: [history[0]], playlists: [saved, empty] } })
  test('renders full-record card and Save counts without rewriting stale imported metadata', async ({ page }, testInfo) => {
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getQuickBookmarkTargetPlaylistId)).toBe(empty._id)
    await page.setViewportSize({ width: 1400, height: 1000 })
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    const useFullRecord = async () => page.evaluate(saved => {
      // Exercise the shared renderer's full-record contract while retaining a
      // real immutable SQLite snapshot to verify rendering does not write it.
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.state.playlists.libraryPaged = false
      store.state.playlists.playlists = [saved]
    }, saved)
    await goTo(page, 'userplaylists')
    const card = page.locator('.tabContent[aria-hidden="false"] .ft-list-item').filter({ has: page.locator('.h3Title', { hasText: saved.playlistName }) })
    await expect(card).toBeVisible()
    await useFullRecord()
    await expect(card).toHaveCount(1)
    await expect(card.locator('.videoCountContainer')).toContainText('2')
    await expect(card.locator('.thumbnailImage')).toHaveAttribute('src', new RegExp(`/vi/${history[0].videoId}/`))
    await expectImagesLoaded(card.locator('.thumbnailImage'))
    await card.screenshot({ path: testInfo.outputPath('retained-full-record-card-count-95.png') })
    await goTo(page, 'history')
    await useFullRecord()
    const historyCard = page.locator('.tabContent[aria-hidden="false"] .ft-list-video').first()
    await historyCard.hover()
    await historyCard.locator('.addToPlaylistIcon .iconButton').click()
    const picker = historyCard.locator('.addToPlaylistDropdown')
    const row = picker.getByRole('option').filter({ has: page.locator('.playlistName', { hasText: saved.playlistName }) })
    await expect(row.locator('.videoCount')).toHaveText('2 videos')
    await expect(row.locator('img')).toHaveAttribute('src', new RegExp(`/vi/${history[0].videoId}/`))
    await expectImagesLoaded(row.locator('img'))
    await picker.screenshot({ path: testInfo.outputPath('retained-full-record-save-count-95.png') })
    expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'counted' }))).toStrictEqual(saved)
    expect(await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'z-counted-empty' }))).toStrictEqual(empty)
  })
})

test.describe('retained null subscription members', () => {
  const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  const entry = { videoId: 'abcdefghijk', title: 'Visible after retained null members', author: 'Example channel', authorId: channelId, type: 'video', lengthSeconds: 120, published: 1700000000000, viewCount: 1000 }
  const cache = { _id: channelId, videos: [...Array(100).fill(null), entry], videosTimestamp: '2026-10-13T00:00:00.000Z', shorts: false, liveStreams: { retained: true }, communityPosts: 'legacy', unknown: { retained: true } }
  test.use({
    seed: {
      settings: { historyWatchedStatusMigrated: true, fetchSubscriptionsAutomatically: false, useRssFeeds: false, uiScale: 95, currentLocale: 'en_US', landingPage: 'history' },
      history: [],
      playlists: [],
      watchStats: [{ _id: 'history-watch-time-v1' }],
      profiles: [{ _id: 'allChannels', name: 'All Channels', subscriptions: [{ id: channelId, name: 'Example channel', thumbnail: '' }] }],
      subscriptionCache: [cache],
    }
  })
  test('loads a valid subscription after an opaque first page without rewriting retained members at 95% scale', async ({ app, page }, testInfo) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await goTo(page, 'subscriptions')
    await page.getByRole('tab', { name: 'Videos', exact: true }).click()
    const content = page.locator('.tabContent[aria-hidden="false"]')
    const card = content.getByText(entry.title, { exact: true })
    const more = content.getByRole('button', { name: 'Load More Videos', exact: true })
    await expect.poll(async () => await card.isVisible() || await more.isVisible()).toBe(true)
    if (!await card.isVisible()) await more.click()
    await expect(card).toBeVisible()
    await expect(content.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
    const file = path.join(app.userDataDir, 'subscription-cache.db')
    const original = await readFile(file, 'utf8')
    expect(original).toBe(JSON.stringify(cache) + '\n')
    const records = (await readPersistedDatastore(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(records.find(record => record._id === channelId)).toStrictEqual(cache)
    await content.screenshot({ path: testInfo.outputPath('retained-null-subscription-members-95.png') })
  })
})
