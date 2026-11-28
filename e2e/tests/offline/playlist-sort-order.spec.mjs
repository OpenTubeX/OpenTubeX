import { chooseSelectOption, test, expect, goTo } from '../../helpers/app.mjs'
import { waitForPlayback } from '../../helpers/player.mjs'
import { captureAppFramebuffer } from '../../helpers/screenshots.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const lastUpdatedAt = 1_700_000_000_000
const video = (videoId, title, index) => ({
  videoId,
  title,
  author: 'Test channel',
  authorId: 'UC-test-channel-id',
  lengthSeconds: 60,
  timeAdded: lastUpdatedAt + index,
  playlistItemId: `${videoId}-item`,
  type: 'video',
})
const videos = [video('sortorder01', 'Charlie video', 0), video('sortorder02', 'Alpha video', 1), video('sortorder03', 'Bravo video', 2)]
const customTitles = ['Charlie video', 'Alpha video', 'Bravo video']
const ascendingTitles = ['Alpha video', 'Bravo video', 'Charlie video']

test.describe.configure({ timeout: 120_000 })

test.use({
  seed: {
    settings: {
      currentLocale: 'en-US',
      animationSpeed: 0,
      userPlaylistSortOrder: 'custom',
      playlistViewType: 'list',
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
    },
    playlists: [
      { _id: 'sorted', playlistName: 'Sorted mix', description: '', protected: false, lastUpdatedAt, videos },
      {
        _id: 'unsorted',
        playlistName: 'Unsorted mix',
        description: '',
        protected: false,
        videos: videos.map(item => ({ ...item, playlistItemId: `${item.videoId}-other` })),
      },
      { _id: 'watchLater', playlistName: 'Watch Later', videos: [] },
    ],
  },
})

async function openPlaylist(page, name) {
  await goTo(page, 'userplaylists')
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.locator('.playlistInfo .playlistTitle')).toHaveText(name)
}

function titles(page) {
  return page.locator('.playlistItems .h3Title').filter({ visible: true })
}

test('each playlist keeps its own sort order across restarts', async ({ app, page, attachScreenshot }) => {
  await openPlaylist(page, 'Sorted mix')
  await expect(titles(page)).toHaveText(customTitles)
  await chooseSelectOption(page.locator('.sortSelect select'), 'video_title_ascending')
  await expect(titles(page)).toHaveText(ascendingTitles)
  await attachScreenshot('playlist-sorted-by-title')

  expect(await page.evaluate(() => {
    const { getters } = window.$store
    const { sortOrder, lastUpdatedAt } = getters.getPlaylist('sorted')
    return { sortOrder, lastUpdatedAt, setting: getters.getUserPlaylistSortOrder }
  })).toEqual({ sortOrder: 'video_title_ascending', lastUpdatedAt, setting: 'custom' })

  await openPlaylist(page, 'Unsorted mix')
  await expect(titles(page)).toHaveText(customTitles)
  await expect(page.locator('.sortSelect select')).toHaveValue('custom')

  // A playlist deleted in another window is not recreated from its sort order.
  await page.evaluate(() => window.$store.dispatch('updatePlaylistSortOrder', { _id: 'deleted', sortOrder: 'custom' }))

  page = (await app.relaunch()).page
  expect(await page.evaluate(() => window.$store.getters.getAllPlaylists.map(playlist => playlist._id))).not.toContain('deleted')
  await openPlaylist(page, 'Sorted mix')
  await expect(page.locator('.sortSelect select')).toHaveValue('video_title_ascending')
  await expect(titles(page)).toHaveText(ascendingTitles)
})

test('the watch page playlist follows the playlist sort order', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openPlaylist(page, 'Sorted mix')
  await chooseSelectOption(page.locator('.sortSelect select'), 'video_title_ascending')
  await titles(page).first().click()
  await waitForPlayback(page)

  const panelTitles = page.locator('.watchVideoPlaylist .playlistItem .h3Title')
  await expect(panelTitles).toHaveText(ascendingTitles)
  // Another tab changing the sort order re-sorts the open playlist.
  await page.evaluate(() => window.$store.dispatch('updatePlaylistSortOrder', { _id: 'sorted', sortOrder: 'video_title_descending' }))
  await expect(panelTitles).toHaveText(ascendingTitles.toReversed())
})

test('the watch page uses a sort preference saved during navigation', async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page)
  await openPlaylist(page, 'Sorted mix')
  await page.evaluate(() => {
    const stop = window.$router.beforeResolve(async to => {
      if (!to.path.startsWith('/watch/')) return
      stop()
      // The playlist page has cached its old order, but the preference save
      // finishes before the watch view is mounted.
      await window.$store.dispatch('updatePlaylistSortOrder', { _id: 'sorted', sortOrder: 'video_title_ascending' })
    })
  })
  await titles(page).first().click()
  await waitForPlayback(page)

  await expect(page.locator('.watchVideoPlaylist .playlistItem .h3Title')).toHaveText(ascendingTitles)
  await testInfo.attach('Sorted watch playlist', {
    body: await page.locator('.watchVideoPlaylist').screenshot(),
    contentType: 'image/png',
  })
})

test.describe('a playlist synced from YouTube', () => {
  const syncedVideos = videos.map(item => ({ ...item, youTubeSetVideoId: `set-${item.videoId}` }))
  /** @param {{ videoId: string, title: string }} item */
  const tile = item => ({
    tileRenderer: {
      contentType: 'TILE_CONTENT_TYPE_VIDEO',
      contentId: item.videoId,
      metadata: {
        tileMetadataRenderer: {
          title: { simpleText: item.title },
          lines: [{ lineRenderer: { items: [{ lineItemRenderer: { text: { simpleText: 'Test channel' } } }] } }],
        },
      },
      header: { tileHeaderRenderer: { thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: '1:00' } } }] } },
      onLongPressCommand: {
        showMenuCommand: {
          menu: {
            menuRenderer: {
              items: [{
                menuServiceItemRenderer: {
                  serviceEndpoint: { playlistEditEndpoint: { actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: `set-${item.videoId}` }] } },
                },
              }],
            },
          },
        },
      },
    },
  })
  const surface = content => ({ contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content } } } } })
  // Bravo video was moved to the top on YouTube.
  const youTubeVideos = [videos[2], videos[0], videos[1]]
  const responses = {
    FEplaylist_aggregation: surface({
      gridRenderer: {
        items: [{
          tileRenderer: {
            contentType: 'TILE_CONTENT_TYPE_PLAYLIST',
            contentId: 'PLsortorder',
            metadata: { tileMetadataRenderer: { title: { simpleText: 'Synced mix' } } },
            header: { tileHeaderRenderer: { thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: '3 videos' } } }] } },
          },
        }],
      },
    }),
    VLPLsortorder: surface({
      twoColumnRenderer: {
        leftColumn: { entityMetadataRenderer: { title: { simpleText: 'Synced mix' }, description: {} } },
        rightColumn: { playlistVideoListRenderer: { contents: youTubeVideos.map(tile) } },
      },
    }),
  }

  test.use({
    seed: {
      settings: {
        currentLocale: 'en-US',
        animationSpeed: 0,
        userPlaylistSortOrder: 'custom',
        playlistViewType: 'list',
        youTubeAccount: {
          credentials: {
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            // Far enough ahead that the sign-in is never refreshed.
            expiry_date: '2999-01-01T00:00:00.000Z',
            client: { client_id: 'test-client-id', client_secret: 'test-client-secret' },
          },
          profiles: [{ name: 'Test Channel', handle: '@testchannel', thumbnail: null, pageId: null }],
          pageId: null,
          channelId: 'UCtestchannel000000000000',
          signInId: 'test-sign-in',
        },
        youTubeAccountSyncPlaylists: true,
      },
      playlists: [{
        _id: 'synced',
        playlistName: 'Synced mix',
        description: '',
        protected: false,
        lastUpdatedAt,
        // Sorted by date added, which YouTube switches to its manual order when a video is moved there.
        sortOrder: 'date_added_ascending',
        videos: syncedVideos,
        youTube: { playlistId: 'PLsortorder', accountKey: 'test-sign-in\n', title: 'Synced mix', signature: null },
      }],
    },
  })

  test('shows the order YouTube has, also after videos moved there', async ({ page }) => {
    await page.route('https://www.youtube.com/youtubei/v1/**', route => {
      const url = route.request().url()
      if (url.includes('/playlist/get_add_to_playlist')) {
        return route.fulfill({ json: { contents: [{ addToPlaylistRenderer: { playlists: [{ playlistAddToOptionRenderer: { playlistId: 'PLsortorder' } }] } }] } })
      }
      const response = url.includes('/browse') ? responses[route.request().postDataJSON()?.browseId] : undefined
      return response ? route.fulfill({ json: response }) : route.abort()
    })

    await goTo(page, 'userplaylists')
    // The link's name starts with the synced icon's label.
    await page.getByRole('link', { name: 'Synced mix' }).click()
    await expect(page.locator('.sortSelect select')).toHaveValue('date_added_ascending')
    await expect(titles(page)).toHaveText(youTubeVideos.map(item => item.title))

    // YouTube has no title order, so that one sorts here.
    await chooseSelectOption(page.locator('.sortSelect select'), 'video_title_ascending')
    await expect(titles(page)).toHaveText(ascendingTitles)
  })
})

test.describe('duration fallback on watch page', () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'en-US',
        animationSpeed: 0,
        playlistViewType: 'list',
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true,
      },
      history: [{
        _id: 'durhist0002',
        videoId: 'durhist0002',
        title: 'Medium from history',
        author: 'Test channel',
        authorId: 'UC-test-channel-id',
        lengthSeconds: 150,
        timeWatched: lastUpdatedAt,
        watchProgress: 10,
        isWatched: false,
      }],
      playlists: [{
        _id: 'duration-fallback',
        playlistName: 'Duration fallback mix',
        description: '',
        protected: false,
        lastUpdatedAt,
        sortOrder: 'video_duration_ascending',
        videos: [
          { ...video('durhist0001', 'Longest video', 0), lengthSeconds: 300 },
          { ...video('durhist0002', 'Medium from history', 1), lengthSeconds: 0 },
          { ...video('durhist0003', 'Shortest video', 2), lengthSeconds: 60 },
        ],
      }],
    },
  })

  test('orders user playlist videos by history fallback duration on both playlist and watch pages', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openPlaylist(page, 'Duration fallback mix')
    const expectedOrder = ['Shortest video', 'Medium from history', 'Longest video']
    await expect(titles(page)).toHaveText(expectedOrder)

    await titles(page).first().click()
    await waitForPlayback(page)
    await expect(page.locator('.watchVideoPlaylist .playlistItem .h3Title')).toHaveText(expectedOrder)
  })
})

test.describe('a remote YouTube playlist', () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'en-US',
        animationSpeed: 0,
        backendPreference: 'invidious',
        backendFallback: false,
        enableSearchSuggestions: false,
        defaultInvidiousInstance: 'https://invidious.test',
        generalAutoLoadMorePaginatedItemsEnabled: false,
        playlistViewType: 'list',
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true,
      },
    },
  })

  test('sorts multi-page YouTube playlists by duration and carries the order to queue and watch page', async ({ app, page }, testInfo) => {
    await page.route('https://invidious.test/vi/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.route('https://invidious.test/ggpht/**', route => fulfillVisualFixture(route, 'avatar'))

    const page1Videos = Array.from({ length: 100 }, (_, index) => ({
      type: 'video',
      title: `Page 1 video ${String(index + 1).padStart(3, '0')}`,
      videoId: `remp1v${String(index).padStart(5, '0')}`,
      author: 'Playlist channel',
      authorId: 'UCplaylistchannel',
      authorUrl: '/channel/UCplaylistchannel',
      videoThumbnails: [],
      index,
      lengthSeconds: 120 + index,
      liveNow: false,
    }))
    const page2Videos = [
      {
        type: 'video',
        title: 'Shortest on page 2',
        videoId: 'remp2short0',
        author: 'Playlist channel',
        authorId: 'UCplaylistchannel',
        authorUrl: '/channel/UCplaylistchannel',
        videoThumbnails: [],
        index: 100,
        lengthSeconds: 30,
        liveNow: false,
      },
      {
        type: 'video',
        title: 'Longest on page 2',
        videoId: 'remp2long00',
        author: 'Playlist channel',
        authorId: 'UCplaylistchannel',
        authorUrl: '/channel/UCplaylistchannel',
        videoThumbnails: [],
        index: 101,
        lengthSeconds: 900,
        liveNow: false,
      },
    ]

    await page.route(/\/api\/v1\/playlists\/remote-sort-test\?/, route => {
      const pageNumber = Number(new URL(route.request().url()).searchParams.get('page') || 1)
      const videosForPage = pageNumber === 1 ? page1Videos : page2Videos
      return route.fulfill({
        json: {
          type: 'playlist',
          title: 'Remote duration playlist',
          playlistId: 'remote-sort-test',
          author: 'Playlist channel',
          authorId: 'UCplaylistchannel',
          authorThumbnails: [{ url: 'https://yt3.ggpht.com/test=s76' }],
          description: 'A remote playlist with varying video durations.',
          descriptionHtml: '',
          videoCount: 102,
          viewCount: 500,
          updated: 1_700_000_000,
          videos: videosForPage,
        },
      })
    })

    const tab = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/playlist/remote-sort-test', makeActive: false }))
    await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
    await expect(page.locator('.playlistInfo .playlistTitle')).toHaveText('Remote duration playlist')

    const sortSelect = page.locator('.sortSelect select')
    await expect(sortSelect).toHaveValue('custom')
    const optionValues = await sortSelect.locator('option').evaluateAll(options => options.map(option => option.value))
    expect(optionValues).not.toContain('date_added_descending')
    expect(optionValues).toContain('video_duration_ascending')
    expect(optionValues).toContain('video_duration_descending')

    // Sorting loads page 2 automatically so the shortest video on page 2 rises to the top.
    await chooseSelectOption(sortSelect, 'video_duration_ascending')
    await expect(titles(page).first()).toHaveText('Shortest on page 2')
    await expect(page.locator('.playlistInfo .playlistThumbnail a')).toHaveAttribute('href', /\/watch\/remp2short0\b/)
    await expect(page.locator('.playlistItems .playlistItem')).toHaveCount(102)
    await expectImagesLoaded(page.locator('.playlistItemsCard .thumbnailImage:visible'))
    await captureAppFramebuffer(app, testInfo, 'remote-playlist-sorted-duration-shortest')

    await chooseSelectOption(sortSelect, 'video_duration_descending')
    await expect(titles(page).first()).toHaveText('Longest on page 2')
    await expect(page.locator('.playlistInfo .playlistThumbnail a')).toHaveAttribute('href', /\/watch\/remp2long00\b/)
    await captureAppFramebuffer(app, testInfo, 'remote-playlist-sorted-duration-longest')

    // Adding to the queue follows the active sort order.
    await page.getByTitle('Add Playlist to Queue', { exact: true }).click()
    await expect(page.getByText('Playlist added to queue', { exact: true })).toBeVisible()
    const queuedFirst = await page.evaluate(() => window.$store.getters.getWatchQueue.slice(0, 2).map(item => item.videoId))
    expect(queuedFirst).toEqual(['remp2long00', 'remp1v00099'])

    // Opening a video carries the sorted order to the watch page playlist panel.
    await titles(page).first().click()
    const watchPlaylist = page.locator('.watchVideoPlaylist')
    await expect(watchPlaylist.locator('.playlistItem')).toHaveCount(102)
    await expect(watchPlaylist.locator('.playlistItem .h3Title').first()).toHaveText('Longest on page 2')
  })
})
