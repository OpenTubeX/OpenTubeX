import { BrowserWindow } from 'electron'

import { IpcChannels } from '../constants'
import { TabManager } from './tabs/TabManager'
import { isOpenTubeXUrl } from './utils'

/**
 * Maps an app or YouTube URL to the app URL that opens it directly, or
 * returns null when the renderer has to resolve it.
 * @param {string | null | undefined} url
 * @param {string} rootAppUrl
 * @returns {string | null}
 */
export function getDirectOpenUrl(url, rootAppUrl) {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return null
  }

  const parsed = URL.parse(url)
  if (!parsed) {
    return null
  }

  if (isOpenTubeXUrl(parsed)) {
    return url
  }

  const videoParams = getDirectVideoParams(parsed)
  if (videoParams.videoId) {
    return createAppRouteUrl(rootAppUrl, `/watch/${videoParams.videoId}`, {
      timestamp: videoParams.timestamp,
      playlistId: videoParams.playlistId,
      commentId: videoParams.commentId,
      short: videoParams.isShort ? 'true' : null
    })
  }

  const playlistId = getDirectPlaylistId(parsed)
  if (playlistId) {
    return createAppRouteUrl(rootAppUrl, `/playlist/${encodeURIComponent(playlistId)}`, getRemainingUrlQuery(parsed, ['list']))
  }

  const searchQuery = getDirectSearchQuery(parsed)
  if (searchQuery) {
    return createAppRouteUrl(rootAppUrl, `/search/${encodeURIComponent(searchQuery)}`, getRemainingUrlQuery(parsed, ['q', 'search_query']))
  }

  const hashtag = parsed.pathname.match(/^\/hashtag\/(?<tag>[^#&/?]+)\/?$/)?.groups?.tag
  if (hashtag) {
    return createAppRouteUrl(rootAppUrl, `/hashtag/${encodeURIComponent(hashtag)}`)
  }

  const postId = parsed.pathname.match(/^\/post\/(?<postId>.+)/)?.groups?.postId
  if (postId) {
    return createAppRouteUrl(rootAppUrl, `/post/${encodeURIComponent(postId)}`, {
      authorId: parsed.searchParams.get('ucid')
    })
  }

  const feedType = parsed.pathname.match(/^\/feed\/(?<type>trending|subscriptions|history|playlists|you|library)/)?.groups?.type
  if (feedType) {
    return createAppRouteUrl(rootAppUrl, feedType === 'playlists' || feedType === 'you' || feedType === 'library'
      ? '/userplaylists'
      : `/${feedType}`)
  }

  return null
}

/**
 * @param {URL} url
 * @returns {{ videoId: string | null, timestamp: string | null, playlistId: string | null, commentId: string | null, isShort: boolean }}
 */
function getDirectVideoParams(url) {
  const params = {
    videoId: null,
    timestamp: null,
    playlistId: null,
    commentId: null,
    isShort: false
  }

  const setVideoId = (value) => {
    const videoId = getYoutubeId(value)
    if (videoId) {
      params.videoId = videoId
      params.timestamp = getDirectTimestamp(url)
      params.playlistId = url.searchParams.get('list')
      params.commentId = url.searchParams.get('lc')
    }
  }

  if (url.pathname === '/watch') {
    setVideoId(url.searchParams.get('v'))
  } else if (url.hostname === 'youtu.be') {
    setVideoId(url.pathname.slice(1))
  } else {
    const videoPath = url.pathname.match(/^\/(?:embed|shorts|live)\/(?<videoId>[\w-]+)/)?.groups?.videoId
    params.isShort = url.pathname.startsWith('/shorts/')
    setVideoId(videoPath)
  }

  return params
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function getYoutubeId(value) {
  return typeof value === 'string'
    ? value.match(/^[\w-]{11}/)?.[0] ?? null
    : null
}

/**
 * @param {URL} url
 * @returns {string | null}
 */
function getDirectTimestamp(url) {
  const timestamp = url.searchParams.get('t')
  if (!timestamp) {
    return null
  }

  const timeParts = timestamp.match(/^(?:(?<hours>\d+)h)?(?:(?<minutes>\d+)m)?(?:(?<seconds>\d+)s?)?$/)?.groups
  if (!timeParts || (!timeParts.hours && !timeParts.minutes && !timeParts.seconds)) {
    return timestamp
  }

  return String(
    Number(timeParts.seconds ?? 0) +
    (Number(timeParts.minutes ?? 0) * 60) +
    (Number(timeParts.hours ?? 0) * 3600)
  )
}

/**
 * @param {URL} url
 * @returns {string | null}
 */
function getDirectPlaylistId(url) {
  if (!/^(\/playlist\/?|\/embed\/videoseries\/?)$/.test(url.pathname)) {
    return null
  }

  return url.searchParams.get('list')
}

/**
 * @param {URL} url
 * @returns {string | null}
 */
function getDirectSearchQuery(url) {
  if (!/^(\/results|\/search\/?)$/.test(url.pathname)) {
    return null
  }

  return url.searchParams.get('search_query') ?? url.searchParams.get('q')
}

/**
 * @param {URL} url
 * @param {string[]} excludedKeys
 * @returns {Record<string, string>}
 */
function getRemainingUrlQuery(url, excludedKeys) {
  const excluded = new Set(excludedKeys)
  const query = {}

  for (const [key, value] of url.searchParams) {
    if (!excluded.has(key)) {
      query[key] = value
    }
  }

  return query
}

/**
 * @param {string} rootAppUrl
 * @param {string} path
 * @param {Record<string, string | number | null | undefined>} [query]
 * @returns {string}
 */
function createAppRouteUrl(rootAppUrl, path, query = {}) {
  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && String(value).length > 0) {
      searchParams.set(key, String(value))
    }
  }

  const search = searchParams.toString()
  return `${rootAppUrl}#${path}${search.length > 0 ? `?${search}` : ''}`
}

/**
 * Opens URLs from deep links, the command line and notifications. A URL with
 * a matching app route opens directly, any other URL is handed to the
 * renderer once it has signalled APP_READY.
 * @param {object} options
 * @param {string} options.rootAppUrl
 * @param {(options?: object) => Promise<import('electron').BrowserWindow>} options.createWindow
 */
export function createUrlOpener({ rootAppUrl, createWindow }) {
  /** @type {Map<number, Array<{url: string, tabId: string | null}>>} */
  const pendingOpenUrlsByWebContentsId = new Map()
  const openUrlReadyWebContentsIds = new Set()

  /**
   * @param {string | null | undefined} url
   * @param {object} [options]
   * @param {boolean} [options.replaceMainWindow]
   * @param {boolean} [options.showWindowNow]
   * @param {boolean} [options.reuseEmptyRootTab]
   * @returns {Promise<import('electron').BrowserWindow>}
   */
  async function createWindowForOpenUrl(url, options = {}) {
    const { reuseEmptyRootTab = false, ...createWindowOptions } = options
    const directOpenUrl = getDirectOpenUrl(url, rootAppUrl)
    const newWindow = await createWindow({
      ...createWindowOptions,
      ...(directOpenUrl ? { windowStartupUrl: directOpenUrl } : {})
    })

    if (!directOpenUrl) {
      openUrlInWindow(newWindow, url, { reuseEmptyRootTab })
    }

    return newWindow
  }

  /**
   * @param {import('electron').BrowserWindow | undefined | null} browserWindow
   * @param {string | null | undefined} url
   * @param {{ reuseEmptyRootTab?: boolean }} [options]
   */
  function openUrlInWindow(browserWindow, url, options = {}) {
    if (!browserWindow || browserWindow.isDestroyed() || !url) {
      return
    }

    const tabManager = TabManager.getForWindow(browserWindow.id)
    if (tabManager) {
      openUrlInTab(tabManager, url, options).catch(error => {
        console.error('Failed to open URL in a tab:', error)
      })
      return
    }

    sendOpenUrlToWebContents(browserWindow.webContents, url)
  }

  /**
   * @param {TabManager} tabManager
   * @param {string} url
   * @param {{ reuseEmptyRootTab?: boolean }} options
   */
  async function openUrlInTab(tabManager, url, options) {
    const directOpenUrl = getDirectOpenUrl(url, rootAppUrl)
    if (directOpenUrl) {
      await tabManager.createTabWithPreference({
        url: directOpenUrl,
        makeActive: true
      })
      return
    }

    let tab = options.reuseEmptyRootTab ? getReusableOpenUrlTab(tabManager) : null

    if (!tab) {
      tab = await tabManager.createTabWithPreference({
        url: rootAppUrl,
        makeActive: true
      })
    }

    sendOpenUrlToWebContents(tabManager.browserWindow.webContents, url, tab.id)
  }

  /**
   * @param {TabManager} tabManager
   * @returns {import('./tabs/TabManager').TabInfo | null}
   */
  function getReusableOpenUrlTab(tabManager) {
    if (tabManager.tabs.size !== 1 || !tabManager.activeTabId) {
      return null
    }

    const activeTab = tabManager.tabs.get(tabManager.activeTabId)
    return activeTab && TabManager.getOpenTubeXRoute(activeTab.url) === '/'
      ? activeTab
      : null
  }

  /**
   * @param {import('electron').WebContents} webContents
   * @param {string} url
   * @param {string | null} [tabId]
   * @returns {boolean}
   */
  function sendOpenUrlToWebContents(webContents, url, tabId = null) {
    const payload = { url, tabId }
    if (
      !webContents.isDestroyed() &&
      openUrlReadyWebContentsIds.has(webContents.id) &&
      isOpenTubeXUrl(webContents.getURL())
    ) {
      webContents.send(IpcChannels.OPEN_URL, payload)
      return true
    }

    const pendingOpenUrls = pendingOpenUrlsByWebContentsId.get(webContents.id) ?? []
    pendingOpenUrls.push(payload)
    // Protocol activations are user-driven, but keep the startup queue bounded
    // in case a desktop environment repeatedly delivers the same URL.
    if (pendingOpenUrls.length > 20) {
      pendingOpenUrls.shift()
    }
    pendingOpenUrlsByWebContentsId.set(webContents.id, pendingOpenUrls)
    return false
  }

  /**
   * @param {import('electron').IpcMainEvent} event
   */
  function openPendingUrlForReadyWebContents(event) {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    openUrlReadyWebContentsIds.add(event.sender.id)

    const pendingOpenUrls = pendingOpenUrlsByWebContentsId.get(event.sender.id)
    if (!pendingOpenUrls || !BrowserWindow.fromWebContents(event.sender)) {
      return
    }

    pendingOpenUrlsByWebContentsId.delete(event.sender.id)
    for (const pendingOpenUrl of pendingOpenUrls) {
      event.reply(IpcChannels.OPEN_URL, pendingOpenUrl)
    }
  }

  return {
    createWindowForOpenUrl,
    openUrlInWindow,
    openPendingUrlForReadyWebContents,
    /**
     * The renderer has to signal APP_READY again after a main-frame navigation.
     * @param {number} webContentsId
     */
    forgetOpenUrlRenderer(webContentsId) {
      openUrlReadyWebContentsIds.delete(webContentsId)
    },
    /**
     * @param {number} webContentsId
     */
    forgetOpenUrlWebContents(webContentsId) {
      pendingOpenUrlsByWebContentsId.delete(webContentsId)
      openUrlReadyWebContentsIds.delete(webContentsId)
    }
  }
}
