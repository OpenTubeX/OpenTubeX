export const HOME_WIDGET_VIDEO_LIMIT = 4
const VIDEO_ID = /^[\w-]{11}$/
const PAGES = {
  search: null,
  subscriptions: { path: '/subscriptions' },
  'watch-later': { path: '/playlist/watchLater', query: { playlistType: 'user' } },
}

/**
 * Resolves a Quick access widget link such as `opentubex://open/search`.
 * @param {string | undefined} url
 * @returns {{ page: string, route: { path: string, query?: object } | null } | null}
 */
export function getHomeWidgetPage(url) {
  const page = /^opentubex(?:-nightly)?:\/\/open\/([a-z-]+)$/.exec(url ?? '')?.[1]
  return page && Object.hasOwn(PAGES, page) ? { page, route: PAGES[page] } : null
}

/**
 * Converts Continue watching history entries into the widgets' cached video list.
 * @param {object[]} entries newest first
 * @param {(videoId: string) => string | null} getThumbnailUrl
 */
export function createContinueWatchingWidgetVideos(entries, getThumbnailUrl) {
  return entries
    .filter(entry => VIDEO_ID.test(entry.videoId ?? ''))
    .slice(0, HOME_WIDGET_VIDEO_LIMIT)
    .map(entry => {
      const lengthSeconds = Number(entry.lengthSeconds)
      return {
        videoId: entry.videoId,
        title: String(entry.title ?? ''),
        author: String(entry.author ?? ''),
        watchProgress: Math.floor(Number(entry.watchProgress)),
        lengthSeconds: Number.isFinite(lengthSeconds) && lengthSeconds > 0 ? Math.floor(lengthSeconds) : 0,
        thumbnail: getThumbnailUrl(entry.videoId) ?? '',
      }
    })
}
