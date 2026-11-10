import { isDownloadPlaybackSupported, isPlayableDownloadFile } from './downloadPlayback.js'
import { localDateKey } from './digitalWellbeing.js'

export const HOME_WIDGET_VIDEO_LIMIT = 4
export const WATCH_TIME_WIDGET_DAYS = 7
const VIDEO_ID = /^[\w-]{11}$/
// `settings` pages open in the settings window instead of a route.
const PAGES = {
  search: null,
  subscriptions: { path: '/subscriptions' },
  'watch-later': { path: '/playlist/watchLater', query: { playlistType: 'user' } },
  history: { path: '/history' },
  playlists: { path: '/userplaylists' },
  downloads: { settings: 'downloads' },
  stats: { path: '/stats' },
}

/**
 * Resolves a home screen widget link such as `opentubex://open/search` or
 * `opentubex://open/download/12`.
 * @param {string | undefined} url
 * @returns {{ page: string, route: { path: string, query?: object } | { settings: string } | null, downloadId?: number } | null}
 */
export function getHomeWidgetPage(url) {
  const match = /^opentubex(?:-nightly)?:\/\/open\/([a-z-]+)(?:\/(\d{1,15}))?$/.exec(url ?? '')
  if (!match) return null
  const [, page, id] = match
  if (page === 'download' && id) return { page, route: null, downloadId: Number(id) }
  return !id && Object.hasOwn(PAGES, page) ? { page, route: PAGES[page] } : null
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

/**
 * Picks the newest downloads that can play offline for the Recent downloads widget.
 * @param {object[]} downloads
 * @param {(download: object) => string | null} getThumbnailUrl
 */
export function createDownloadWidgetItems(downloads, getThumbnailUrl) {
  return downloads
    .filter(download => isDownloadPlaybackSupported(download) && download.files?.some(isPlayableDownloadFile))
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || b.id - a.id)
    .slice(0, HOME_WIDGET_VIDEO_LIMIT)
    .map(download => {
      const file = download.files.find(isPlayableDownloadFile)
      return {
        id: download.id,
        title: String(download.title || file.title || ''),
        author: String(file.author || download.author || ''),
        thumbnail: getThumbnailUrl(download) ?? '',
      }
    })
}

/**
 * Watched seconds for the last days up to today, keyed by local date. Widgets
 * draw their own week so they roll over at midnight without the app.
 * Reading every entry lets a reactive caller also notice days added after midnight.
 * @param {Record<string, number>} secondsByDate
 * @param {number} now
 */
export function createWatchTimeWidgetDays(secondsByDate, now = Date.now()) {
  const today = new Date(now)
  const week = new Set(Array.from({ length: WATCH_TIME_WIDGET_DAYS }, (_, offset) =>
    localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset).getTime())))
  const days = {}
  for (const [key, value] of Object.entries(secondsByDate)) {
    const seconds = Math.floor(Number(value))
    if (week.has(key) && seconds > 0) days[key] = seconds
  }
  return days
}
