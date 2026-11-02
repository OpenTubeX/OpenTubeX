import { fileURLToPath } from 'node:url'

import { expect } from '@playwright/test'

import { openMockedVideo } from './player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from './watch.mjs'

/** The only video the mocked watch page can play. */
export const PLAYABLE_VIDEO_ID = 'jNQXAC9IVRw'
export const PLAYLIST_PAGE_SIZE = 100
const PLAYLIST_ID = 'PLpagedplaylist'
const CONTINUATION_PREFIX = 'paged-playlist-page-'

/**
 * @param {number} index
 * @param {number} playableIndex position of the mocked playable video
 */
export function pagedPlaylistVideoId(index, playableIndex) {
  return index === playableIndex ? PLAYABLE_VIDEO_ID : `pv${String(index).padStart(9, '0')}`
}

function videoRenderer(index, playableIndex) {
  const videoId = pagedPlaylistVideoId(index, playableIndex)
  return {
    playlistVideoRenderer: {
      videoId,
      title: { simpleText: `Paged video ${index + 1}`, accessibility: { accessibilityData: { label: `Paged video ${index + 1}` } } },
      index: { simpleText: String(index + 1) },
      shortBylineText: { runs: [{ text: 'Test', navigationEndpoint: { browseEndpoint: { browseId: 'UCtest' } } }] },
      thumbnail: { thumbnails: [] },
      isPlayable: true,
      lengthSeconds: '10',
      lengthText: { simpleText: '0:10' },
      navigationEndpoint: { watchEndpoint: { videoId } }
    }
  }
}

function continuationRenderer(pageNumber) {
  return {
    continuationItemRenderer: {
      trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN',
      continuationEndpoint: {
        continuationCommand: { token: `${CONTINUATION_PREFIX}${pageNumber}`, request: 'CONTINUATION_REQUEST_TYPE_BROWSE' }
      }
    }
  }
}

/**
 * Opens the watch view for a YouTube playlist served by the local API, with
 * only its first page loaded, like the playlist page caches it. Later pages
 * come from mocked continuation requests, which the returned list records.
 *
 * @param {{ app: object, page: import('@playwright/test').Page }} fixtures
 * @param {{ videoCount: number, playableIndex?: number, startIndex?: number, cachedPageCount?: number, beforePage?: (pageNumber: number) => Promise<void> | void }} options
 *   `startIndex` opens the watch view on that position instead of the playable video.
 *   `beforePage` can hold back a page response until the promise it returns settles.
 */
export async function openPagedPlaylist({ app, page }, { videoCount, playableIndex = 0, startIndex = playableIndex, cachedPageCount = 1, beforePage }) {
  await mockPlayableWatchPage(app, page)
  await page.route('https://i.ytimg.com/**', route => route.fulfill({
    path: fileURLToPath(new URL('../fixtures/media/video-thumbnail.svg', import.meta.url)),
    contentType: 'image/svg+xml'
  }))

  const pageCount = Math.ceil(videoCount / PLAYLIST_PAGE_SIZE)
  /** @type {number[]} */
  const requestedPages = []
  await page.route('**/youtubei/v1/browse**', async route => {
    const continuation = route.request().postDataJSON()?.continuation
    if (typeof continuation !== 'string' || !continuation.startsWith(CONTINUATION_PREFIX)) return route.fallback()

    const pageNumber = Number(continuation.slice(CONTINUATION_PREFIX.length))
    requestedPages.push(pageNumber)
    await beforePage?.(pageNumber)
    const first = (pageNumber - 1) * PLAYLIST_PAGE_SIZE
    const items = Array.from({ length: Math.min(PLAYLIST_PAGE_SIZE, videoCount - first) }, (_, offset) => videoRenderer(first + offset, playableIndex))
    if (pageNumber < pageCount) items.push(continuationRenderer(pageNumber + 1))
    return route.fulfill({ json: { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: items } }] } })
  })

  await openMockedVideo(page)
  const watch = await watchViewHandle(page)
  const cachedCount = Math.min(videoCount, cachedPageCount * PLAYLIST_PAGE_SIZE)
  await watch.evaluate((view, { cachedCount, pageCount, cachedPageCount, playableIndex, startVideoId, videoCount, playlistId, prefix, playable }) => {
    view.$store.commit('setCachedPlaylist', {
      tabId: view.tabId,
      value: {
        id: playlistId,
        title: 'Paged playlist',
        totalVideoCount: videoCount,
        channelName: 'Test',
        channelId: '',
        items: Array.from({ length: cachedCount }, (_, index) => ({
          type: 'video',
          videoId: index === playableIndex ? playable : `pv${String(index).padStart(9, '0')}`,
          title: `Paged video ${index + 1}`,
          author: 'Test',
          lengthSeconds: 10
        })),
        continuationData: cachedPageCount < pageCount
          ? JSON.stringify({
              context: { client: { clientName: 'WEB', clientVersion: '2.20261006.00.00' }, user: {}, request: {} },
              path: '/browse',
              payload: { continuation: `${prefix}${cachedPageCount + 1}` }
            })
          : null
      }
    })
    return view.tabRouter.push({ path: `/watch/${startVideoId}`, query: { playlistId } })
  }, {
    cachedCount,
    pageCount,
    cachedPageCount,
    playableIndex,
    startVideoId: pagedPlaylistVideoId(startIndex, playableIndex),
    videoCount,
    playlistId: PLAYLIST_ID,
    prefix: CONTINUATION_PREFIX,
    playable: PLAYABLE_VIDEO_ID
  })

  const panel = page.locator('.watchVideoPlaylist')
  await expect(panel.locator('.playlistItem').first()).toBeAttached()
  return { watch, panel, requestedPages }
}

/**
 * Waits until the playlist has no page request in flight.
 * @param {import('@playwright/test').JSHandle} watch
 */
export async function waitForPlaylistPagesIdle(watch) {
  await expect.poll(() => watch.evaluate(view => view.$refs.watchVideoPlaylist?.isFetchingPlaylistContinuation)).toBe(false)
}
