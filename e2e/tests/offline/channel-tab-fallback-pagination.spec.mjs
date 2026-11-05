import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { test, expect } from '../../helpers/app.mjs'
import { fixtureKey } from '../../helpers/innertube.mjs'

const fixtures = new URL('../../fixtures/innertube/channel/loads-the-glitch-channel-home-and-playlists-tabs/', import.meta.url)
const channelId = 'UCn_FAXem2-e3HQvmK-mOH4g'
const SHORTS_TAB_KEY = 'browse-185c135d16de'
const PLAYLISTS_TAB_KEY = 'browse-7fa98cd7310f'

function invidiousChannel(tabs) {
  return {
    author: 'Glitch',
    authorId: channelId,
    authorThumbnails: [],
    authorBanners: [],
    description: '',
    subCount: 0,
    totalViews: 0,
    joined: 0,
    tabs,
    relatedChannels: []
  }
}

function invidiousPlaylist(title) {
  return {
    type: 'playlist',
    title,
    playlistId: `PL-${title.replaceAll(' ', '-')}`,
    playlistThumbnail: '',
    author: 'Glitch',
    authorId: channelId,
    videoCount: 1,
    videos: []
  }
}

/**
 * Answers Innertube requests from the recorded Glitch channel.
 * @param {import('@playwright/test').Page} page
 * @param {(key: string, body: object) => object | null | undefined} [override]
 *   Returns a response to send instead of the fixture, or `null` to fail the request.
 */
async function routeLocalChannel(page, override) {
  await page.route('**/youtubei/v1/**', async route => {
    const request = route.request()
    const key = fixtureKey(request.url(), request.postData())
    const overridden = override?.(key, JSON.parse(request.postData() ?? '{}'))
    if (overridden === null) return route.fulfill({ status: 500, json: {} })
    if (overridden) return route.fulfill({ json: overridden })
    await route.fulfill({ json: JSON.parse(gunzipSync(await readFile(new URL(`${key}.0.json.gz`, fixtures)))) })
  })
}

async function openChannel(page, channelTab = '') {
  const tab = await page.evaluate(route => window.ftElectron.tabs.create({
    route,
    makeActive: false
  }), `/channel/${channelId}/${channelTab}`)
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
}

function openPlaylistsTab(page) {
  return page.getByRole('tab', { name: 'Playlists', exact: true }).click()
}

function playlistTitle(page, title) {
  return page.locator('#playlistPanel').getByRole('heading', { name: title, exact: true })
}

test.describe('local channel', () => {
  test.use({
    seed: {
      settings: {
        backendPreference: 'local',
        backendFallback: true,
        defaultInvidiousInstance: 'https://invidious.test',
        generalAutoLoadMorePaginatedItemsEnabled: false
      }
    }
  })

  test('a tab that fell back to Invidious loads its next page from Invidious', async ({ page }) => {
    await routeLocalChannel(page, key => key === PLAYLISTS_TAB_KEY ? null : undefined)
    const continuations = []
    await page.route(`https://invidious.test/api/v1/channels/${channelId}/playlists**`, route => {
      const continuation = new URL(route.request().url()).searchParams.get('continuation')
      continuations.push(continuation)
      return route.fulfill({
        json: continuation === 'page-2'
          ? { playlists: [invidiousPlaylist('Invidious page two')], continuation: null }
          : { playlists: [invidiousPlaylist('Invidious page one')], continuation: 'page-2' }
      })
    })

    await openChannel(page)
    await openPlaylistsTab(page)
    await expect(playlistTitle(page, 'Invidious page one')).toBeVisible()

    await page.getByRole('button', { name: 'Fetch more results' }).click()
    await expect(playlistTitle(page, 'Invidious page two')).toBeVisible()
    await expect(playlistTitle(page, 'Invidious page one')).toBeVisible()
    expect(continuations).toEqual([null, 'page-2'])
  })

  test('tabs reloaded after the channel falls back to Invidious start from their first page', async ({ page }) => {
    await routeLocalChannel(page, key => key === SHORTS_TAB_KEY ? null : undefined)
    const videoContinuations = []
    let shortsRequested = false
    await page.route(`https://invidious.test/api/v1/channels/${channelId}**`, route => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/videos')) {
        videoContinuations.push(url.searchParams.get('continuation'))
        return route.fulfill({
          json: {
            videos: [{ type: 'video', videoId: 'invidiousaaa', title: 'Invidious video', author: 'Glitch', authorId: channelId, lengthSeconds: 60, videoThumbnails: [] }],
            continuation: null
          }
        })
      }
      if (url.pathname.endsWith('/shorts')) {
        shortsRequested = true
        return route.fulfill({ json: { videos: [], continuation: null } })
      }
      return route.fulfill({ json: invidiousChannel(['videos', 'shorts']) })
    })

    await openChannel(page, 'videos')
    const videos = page.locator('#videoPanel .ft-list-video')
    await expect(videos.first()).toBeVisible()
    // The recorded videos tab has a next page, which only the local API can load.
    await expect(page.getByRole('button', { name: 'Fetch more results' })).toBeVisible()

    // The failing shorts tab reloads the whole channel from Invidious.
    await page.getByRole('tab', { name: 'Shorts', exact: true }).click()
    await expect.poll(() => shortsRequested).toBe(true)
    await page.getByRole('tab', { name: 'Videos', exact: true }).click()
    await expect.poll(() => videoContinuations).toEqual([null])
    await expect(videos).toHaveCount(1)
    await expect(videos.getByRole('heading', { name: 'Invidious video', exact: true })).toBeVisible()
  })
})

test.describe('Invidious channel', () => {
  test.use({
    seed: {
      settings: {
        backendPreference: 'invidious',
        backendFallback: true,
        defaultInvidiousInstance: 'https://invidious.test',
        generalAutoLoadMorePaginatedItemsEnabled: false
      }
    }
  })

  test('channel search loads more Invidious pages until one comes back empty', async ({ page }) => {
    const searchPages = []
    await page.route(`https://invidious.test/api/v1/channels/${channelId}**`, route => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/search')) {
        const searchPage = Number(url.searchParams.get('page'))
        searchPages.push(searchPage)
        return route.fulfill({
          json: searchPage > 2
            ? []
            : [{ type: 'video', videoId: `invidious-p${searchPage}`, title: `Search page ${searchPage}`, author: 'Glitch', authorId: channelId, lengthSeconds: 60, videoThumbnails: [] }]
        })
      }
      if (url.pathname.endsWith('/videos')) {
        return route.fulfill({ json: { videos: [], continuation: null } })
      }
      return route.fulfill({ json: invidiousChannel(['videos']) })
    })

    await openChannel(page)
    const search = page.locator('.channelSearch input')
    await search.fill('glitch')
    await search.press('Enter')
    const results = page.locator('.channelSearchResults')
    const fetchMore = page.getByRole('button', { name: 'Fetch more results' })
    await expect(results.getByRole('heading', { name: 'Search page 1', exact: true })).toBeVisible()

    await fetchMore.click()
    await expect(results.getByRole('heading', { name: 'Search page 2', exact: true })).toBeVisible()
    await expect(results.getByRole('heading', { name: 'Search page 1', exact: true })).toBeVisible()

    const emptyPage = page.waitForResponse(response => new URL(response.url()).searchParams.get('page') === '3')
    await fetchMore.click()
    expect(await (await emptyPage).finished()).toBeNull()
    // The button also hides while the page loads, so let the response render first.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(fetchMore).toBeHidden()
    expect(searchPages).toEqual([1, 2, 3])
  })

  test('a tab that fell back to the local API loads its next page from the local API', async ({ page }) => {
    // The recorded playlists tab has no next page, so add one with a copy of its first card.
    const playlistsTab = JSON.parse(gunzipSync(await readFile(new URL(`${PLAYLISTS_TAB_KEY}.0.json.gz`, fixtures))))
    const grid = playlistsTab.contents.twoColumnBrowseResultsRenderer.tabs
      .find(tab => tab.tabRenderer?.selected).tabRenderer
      .content.sectionListRenderer.contents[0].itemSectionRenderer.contents[0].gridRenderer
    const pageTwoItem = structuredClone(grid.items[0])
    pageTwoItem.lockupViewModel.contentId = 'PLlocalPageTwo'
    pageTwoItem.lockupViewModel.metadata.lockupMetadataViewModel.title.content = 'Local page two'
    grid.items.push({
      continuationItemRenderer: {
        trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN',
        continuationEndpoint: { continuationCommand: { token: 'local-page-2', request: 'CONTINUATION_REQUEST_TYPE_BROWSE' } }
      }
    })
    const localContinuations = []
    await routeLocalChannel(page, (key, body) => {
      if (key === PLAYLISTS_TAB_KEY) return playlistsTab
      if (body.continuation) {
        localContinuations.push(body.continuation)
        return { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [pageTwoItem] } }] }
      }
    })

    const invidiousRequests = []
    await page.route(`https://invidious.test/api/v1/channels/${channelId}**`, route => {
      const url = new URL(route.request().url())
      invidiousRequests.push(url.pathname + url.search)
      if (url.pathname.endsWith('/playlists')) {
        return route.fulfill({ status: 500, json: { error: 'Playlists unavailable' } })
      }
      return route.fulfill({ json: invidiousChannel(['videos', 'playlists']) })
    })
    await page.route(`https://invidious.test/api/v1/channels/${channelId}/videos**`, route => route.fulfill({
      json: { videos: [], continuation: null }
    }))

    await openChannel(page)
    await openPlaylistsTab(page)
    await expect(playlistTitle(page, 'Meta Runner').first()).toBeVisible()
    const requestsBeforeLoadMore = invidiousRequests.length

    await page.getByRole('button', { name: 'Fetch more results' }).click()
    await expect(playlistTitle(page, 'Local page two')).toBeVisible()
    await expect(playlistTitle(page, 'Meta Runner').first()).toBeVisible()
    expect(invidiousRequests.slice(requestsBeforeLoadMore)).toEqual([])
    expect(localContinuations).toEqual(['local-page-2'])
  })
})
